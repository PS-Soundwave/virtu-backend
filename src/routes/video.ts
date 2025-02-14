import { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand, } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { join } from 'path';
import { mkdtemp, writeFile, readFile, unlink, readdir, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { authenticateRequest } from '../middleware/auth.js';
import { gzip } from 'zlib';
import { promisify } from 'util';
import OpenAI from 'openai';

const s3Client = new S3Client({ 
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY
  }
});

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY
});

async function processVideoAsync(
  inputPath: string,
  outputDir: string,
  key: string,
  logger: FastifyBaseLogger,
  user: string
) {
  try {
    // Extract first frame as WebP thumbnail
    await new Promise<void>((resolve, reject) => {
      const thumbnailPath = join(outputDir, 'thumbnail.webp');
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-vframes', '1',
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        thumbnailPath
      ]);

      ffmpeg.stderr.on('data', (data) => {
        logger.info({ info: data.toString().trim() }, 'Thumbnail Generation Info');
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Thumbnail generation exited with code ${code}`));
          return;
        }

        resolve();
      });
    });

    // Process video for HLS
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-profile:v', 'high',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-g', '30',
        '-force_key_frames', 'expr:gte(t,n_forced*1)',
        '-progress', 'pipe:1',
        '-filter_complex',
        '[0:v]fps=30,split=3[v1][v2][v3];[v1]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[1080p];[v2]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2[720p];[v3]scale=480:854:force_original_aspect_ratio=decrease,pad=480:854:(ow-iw)/2:(oh-ih)/2[480p]',
        '-map', '[480p]',
        '-map', '[720p]',
        '-map', '[1080p]',
        '-map', '0:a',
        '-map', '0:a',
        '-map', '0:a',
        '-var_stream_map', 'v:0,a:0,name:480p v:1,a:1,name:720p v:2,a:2,name:1080p',
        '-b:v:0', '2.5M',
        '-maxrate:0', '2.5M',
        '-bufsize:0', '2.5M',
        '-b:v:1', '4M',
        '-maxrate:1', '4M',
        '-bufsize:1', '4M',
        '-b:v:2', '8M',
        '-maxrate:2', '8M',
        '-bufsize:2', '8M',
        '-f', 'hls',
        '-hls_time', '1',
        '-hls_segment_type', 'fmp4',
        '-hls_flags', 'independent_segments',
        '-hls_playlist_type', 'vod',
        '-master_pl_name', 'master.m3u8',
        '-hls_segment_filename', join(outputDir, '%v_segment_%d.m4s'),
        '-y',
        join(outputDir, '%v_index.m3u8')
      ]);

      ffmpeg.stdout.on('data', (data) => {
        const progress = data.toString();
        if (progress.includes('frame=')) {
          logger.info({ progress: progress.trim() }, 'FFMPEG Progress');
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        logger.info({ info: data.toString().trim() }, 'FFMPEG Info');
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`FFMPEG process exited with code ${code}`));
          return;
        }

        resolve();
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`Failed to spawn FFMPEG process: ${err.message}`));
      });
    });

    // Upload all generated files to S3
    const files = await readdir(outputDir);
    await Promise.all(files.map(async (file) => {
      const filePath = join(outputDir, file);
      let fileContent = await readFile(filePath);
      
      // Set proper MIME types for HLS and WebP
      let contentType;
      let contentEncoding;
      
      if (file.endsWith('.m3u8')) {
        contentType = 'application/vnd.apple.mpegurl';
        // Gzip the playlist
        fileContent = await promisify(gzip)(fileContent);
        contentEncoding = 'gzip';
      } else if (file === 'init.mp4') {
        contentType = 'video/mp4';
      } else if (file.endsWith('.m4s')) {
        contentType = 'video/iso.segment';
      } else if (file.endsWith('.webp')) {
        contentType = 'image/webp';
      } else {
        contentType = 'application/octet-stream';
      }

      const uploadParams = contentEncoding ? {
        Bucket: env.S3_BUCKET,
        Key: `${key}/${file}`,
        Body: fileContent,
        ContentType: contentType,
        ContentEncoding: contentEncoding
      } : {
        Bucket: env.S3_BUCKET,
        Key: `${key}/${file}`,
        Body: fileContent,
        ContentType: contentType
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
    }));

    const video = await db.insertInto('videos')
        .values({
          key: `${key}/master.m3u8`,  // Store the directory path,
          thumbnail_key: `${key}/thumbnail.webp`,
          uploader: user
        })
        .returning(['id'])
        .executeTakeFirst();

    if (!video) {
      throw new Error('Error inserting video');
    }

    // Extract audio for speech recognition
    const audioPath = join(outputDir, 'audio.wav');
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        audioPath
      ]);

      ffmpeg.stderr.on('data', (data) => {
        logger.info({ info: data.toString().trim() }, 'Audio Extraction Info');
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Audio extraction exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

    // Generate subtitles using whisper.cpp
    const whisperPath = join(outputDir, 'subtitles');
    const subtitlesPath = join(outputDir, 'subtitles.json');
    await new Promise<void>((resolve, reject) => {
      const whisper = spawn('whisper-cpp', [
        '--model', 'models/ggml-base.en.bin',
        '--output-json',
        '--output-file', whisperPath,
        audioPath
      ]);

      whisper.stderr.on('data', (data) => {
        const output = data.toString().trim();
        // Check if the line contains progress information
        if (output.includes('progress')) {
          logger.info({ progress: output }, 'Whisper Progress');
        } else {
          logger.info({ info: output }, 'Speech Recognition Info');
        }
      });

      whisper.stdout.on('data', (data) => {
        logger.info({ output: data.toString().trim() }, 'Whisper Output');
      });

      whisper.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Speech recognition exited with code ${code}`));
          return;
        }

        resolve();
      });
    });

    // Read and parse the subtitles
    const subtitlesJson = await readFile(subtitlesPath, 'utf-8');
    const subtitles = JSON.parse(subtitlesJson);

    logger.info({ subtitles }, "parsed")

    // Insert all subtitles
    for (const segment of subtitles.transcription) {
      await db
        .insertInto('subtitles')
        .values({
          video_id: video.id,
          start_time: segment.offsets.from,
          end_time: segment.offsets.to,
          text: segment.text
        })
        .execute();
    }

    logger.info({}, "inserted")

    // Cleanup
    await Promise.all([
      unlink(inputPath),
      rm(outputDir, { recursive: true, force: true })
    ]);
  } catch (error) {
    logger.error({ error }, 'Video processing failed');
    
    // Attempt cleanup
    try {
      await Promise.all([
        unlink(inputPath),
        rm(outputDir, { recursive: true, force: true })
      ]);
    } catch (cleanupError) {
      logger.error({ error: cleanupError }, 'Cleanup failed');
    }
  }
}

interface ClipSuggestion {
  startTime: number;
  endTime: number;
  confidence: number;
  reason: string;
}

interface SubtitleSegment {
  start_time: number;
  end_time: number;
  text: string;
}

interface AnalysisWindow {
  subtitles: SubtitleSegment[];
  startIndex: number;
  endIndex: number;
}

async function analyzeContent(
  subtitles: SubtitleSegment[],
  prompt: string,
  logger: FastifyBaseLogger
): Promise<ClipSuggestion[]> {
  // Create overlapping windows with 30-second stride
  const windowSize = 120; // 2 minutes
  const stride = 90; // 30 seconds overlap
  const contextWindows: AnalysisWindow[] = [];
  
  // Create windows based on time ranges rather than indices
  let currentStartTime = 0;
  const lastStartTime = subtitles[subtitles.length - 1].start_time;

  while (currentStartTime <= lastStartTime) {
    const windowEnd = currentStartTime + windowSize;
    const windowSubtitles = subtitles.filter(
      s => s.start_time >= currentStartTime && s.start_time <= windowEnd
    );

    if (windowSubtitles.length > 0) {
      const startIndex = subtitles.findIndex(s => s === windowSubtitles[0]);
      const endIndex = subtitles.findIndex(s => s === windowSubtitles[windowSubtitles.length - 1]);
      
      if (startIndex !== -1 && endIndex !== -1) {
        contextWindows.push({
          subtitles: windowSubtitles,
          startIndex,
          endIndex
        });
      }
    }

    currentStartTime += stride;
  }

  logger.info({ 
    windowCount: contextWindows.length,
    firstWindow: contextWindows[0],
    lastWindow: contextWindows[contextWindows.length - 1],
    totalSubtitles: subtitles.length
  }, 'Created context windows');

  // Analyze each window
  const rawSuggestions: Array<{
    startIndex: number;
    endIndex: number;
    confidence: number;
    reason: string;
  }> = [];

  for (const [windowIndex, window] of contextWindows.entries()) {
    const text = window.subtitles.map(s => 
      `[${s.start_time}s - ${s.end_time}s] ${s.text}`
    ).join('\n');
    
    try {
      logger.info({ windowIndex, textLength: text.length }, 'Analyzing window');

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "system",
          content: `You are analyzing a transcript segment to find ${prompt}. 
          Each line of the transcript has a timestamp range in milliseconds.
          Return JSON with segments that match the prompt:
          {
            "segments": [
              {
                "startTime": number, // timestamp in milliseconds
                "endTime": number,   // timestamp in milliseconds
                "confidence": number,
                "reason": string
              }
            ]
          }`
        }, {
          role: "user",
          content: text
        }],
        temperature: 0.2,
        max_tokens: 500
      }, {
        timeout: 10000
      });

      const responseContent = response.choices[0].message?.content;
      if (!responseContent) {
        logger.warn({ windowIndex }, 'Empty response from OpenAI');
        continue;
      }

      logger.info({ windowIndex, responseContent }, 'Got response from OpenAI');

      try {
        const result = JSON.parse(responseContent);
        if (result.segments && Array.isArray(result.segments)) {
          for (const segment of result.segments) {
            if (segment.confidence > 0.6) {
              // Find the closest subtitles to the suggested timestamps
              const startSubtitle = subtitles.reduce((prev, curr) => {
                const prevDiff = Math.abs(prev.start_time - segment.startTime);
                const currDiff = Math.abs(curr.start_time - segment.startTime);
                return currDiff < prevDiff ? curr : prev;
              });

              const endSubtitle = subtitles.reduce((prev, curr) => {
                const prevDiff = Math.abs(prev.end_time - segment.endTime);
                const currDiff = Math.abs(curr.end_time - segment.endTime);
                return currDiff < prevDiff ? curr : prev;
              });

              const startIndex = subtitles.findIndex(s => s === startSubtitle);
              const endIndex = subtitles.findIndex(s => s === endSubtitle);

              if (startIndex !== -1 && endIndex !== -1) {
                rawSuggestions.push({
                  startIndex,
                  endIndex,
                  confidence: segment.confidence,
                  reason: segment.reason
                });
              }
            }
          }
        }
      } catch (parseError) {
        logger.error({ windowIndex, responseContent, error: parseError }, 'Failed to parse OpenAI response');
        continue;
      }
    } catch (error: any) {
      logger.error({ 
        error: error.message, 
        windowIndex,
        status: error.status,
        code: error.code 
      }, 'Error analyzing content window');
      continue;
    }
  }

  logger.info({ 
    rawSuggestionsCount: rawSuggestions.length,
    rawSuggestions 
  }, 'Generated raw suggestions');

  if (rawSuggestions.length === 0) {
    return [];
  }

  // Merge overlapping or nearby segments
  const mergedSuggestions: ClipSuggestion[] = [];
  const sortedSuggestions = rawSuggestions.sort((a, b) => a.startIndex - b.startIndex);
  
  let currentSegment = sortedSuggestions[0];
  
  for (let i = 1; i < sortedSuggestions.length; i++) {
    const nextSegment = sortedSuggestions[i];
    
    // If segments overlap or are within 3 subtitles of each other, merge them
    if (nextSegment.startIndex <= currentSegment.endIndex + 3) {
      currentSegment = {
        startIndex: currentSegment.startIndex,
        endIndex: Math.max(currentSegment.endIndex, nextSegment.endIndex),
        confidence: Math.max(currentSegment.confidence, nextSegment.confidence),
        reason: `${currentSegment.reason}; ${nextSegment.reason}`
      };
    } else {
      // Add current segment to final results
      mergedSuggestions.push({
        startTime: subtitles[currentSegment.startIndex].start_time,
        endTime: subtitles[currentSegment.endIndex].end_time,
        confidence: currentSegment.confidence,
        reason: currentSegment.reason
      });
      currentSegment = nextSegment;
    }
  }
  
  // Add the last segment
  if (currentSegment && sortedSuggestions.length > 0) {
    mergedSuggestions.push({
      startTime: subtitles[currentSegment.startIndex].start_time,
      endTime: subtitles[currentSegment.endIndex].end_time,
      confidence: currentSegment.confidence,
      reason: currentSegment.reason
    });
  }

  logger.info({ 
    mergedSuggestionsCount: mergedSuggestions.length,
    mergedSuggestions 
  }, 'Generated merged suggestions');

  // Sort by confidence and return top results
  return mergedSuggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

export async function processVideoUpload(fastify: FastifyInstance) {
  fastify.post('/video', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    try {
      // Get the user's UUID from their Firebase ID
      const user = await db.selectFrom('users')
        .select(['id'])
        .where('firebase_id', '=', request.uid!)
        .executeTakeFirst();

      if (!user) {
        return reply.status(401).send();
      }

      const data = await request.file();
      
      if (!data) {
        throw new Error('No file uploaded');
      }

      const fileId = uuidv4();
      const key = fileId;  // We'll use this as a directory name now
      let totalBytesReceived = 0;
      const totalBytes = parseInt(request.headers['content-length'] || '0');
      const tempDir = await mkdtemp(join(tmpdir(), 'video-'));
      const inputPath = join(tempDir, 'input.mp4');
      const outputDir = join(tempDir, 'output');
      await mkdir(outputDir);

      // Collect file chunks
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        totalBytesReceived += chunk.length;
        request.log.info(`Received chunk: ${chunk.length} bytes (${totalBytesReceived}/${totalBytes} total)`);
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);

      // Write input file
      await writeFile(inputPath, fileBuffer);

      // Start async processing
      Promise.resolve().then(async () => await processVideoAsync(
        inputPath,
        outputDir,
        key,
        request.log,
        user.id
      ).catch(error => {
        request.log.error({ error }, 'Async processing failed');
      }));

      return reply.status(201).send();
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send();
    }
  });

  fastify.get<{Reply: Video[]}>('/video', async (request, reply) => {
    try {
      const videos = await db
        .selectFrom('videos')
        .select(['id', 'key', 'thumbnail_key'])
        .orderBy('created_at', 'desc')
        .execute();

      return reply.status(200).send(videos);
    } catch (error) {
      console.error('Error fetching videos:', error);
      return reply.status(500).send();
    }
  });
}

export type Video = {
  id: string,
  key: string,
  thumbnail_key: string
}

export function registerVideoRoutes(fastify: FastifyInstance) {
  processVideoUpload(fastify);

  fastify.get('/video/:videoId/subtitles', async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    
    // Check if video exists
    const video = await db.selectFrom('videos')
      .where('id', '=', videoId)
      .selectAll()
      .executeTakeFirst();
  
    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }
  
    // Get subtitles
    const subtitles = await db.selectFrom('subtitles')
      .where('video_id', '=', videoId)
      .select(['start_time', 'end_time', 'text'])
      .orderBy('start_time')
      .execute();

    if (!subtitles || subtitles.length === 0) {
      return reply.status(404).send({ error: 'No subtitles found for this video' });
    }

    return reply.send({ subtitles });
  });

  fastify.get('/video/:videoId/suggest-clips', async (request, reply) => {
    const { videoId } = request.params as { videoId: string };
    const { prompt } = request.query as { prompt?: string };

    if (!prompt) {
      return reply.status(400).send({ error: 'Missing prompt parameter' });
    }

    // Check if video exists
    const video = await db.selectFrom('videos')
      .where('id', '=', videoId)
      .selectAll()
      .executeTakeFirst();

    if (!video) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    // Get subtitles
    const subtitles = await db.selectFrom('subtitles')
      .where('video_id', '=', videoId)
      .select(['start_time', 'end_time', 'text'])
      .orderBy('start_time')
      .execute();

    if (!subtitles || subtitles.length === 0) {
      return reply.status(404).send({ error: 'No subtitles found for this video' });
    }

    request.log.info({ 
      videoId, 
      subtitlesCount: subtitles.length,
      firstSubtitle: subtitles[0],
      lastSubtitle: subtitles[subtitles.length - 1]
    }, 'Processing clip suggestions request');

    try {
      const suggestions = await analyzeContent(subtitles, prompt, request.log);
      request.log.info({ suggestionsCount: suggestions.length }, 'Generated clip suggestions');
      return reply.send(suggestions);
    } catch (error) {
      request.log.error({ error }, 'Error generating clip suggestions');
      return reply.status(500).send({ error: 'Error generating clip suggestions' });
    }
  });
}
