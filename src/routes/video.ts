import { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MediaConvertClient, CreateJobCommand, type CreateJobCommandInput, GetJobCommand } from '@aws-sdk/client-mediaconvert';
import { env } from '../env.js';
import { db } from '../db/index.js';

const s3Client = new S3Client({ region: env.AWS_REGION });
const mediaConvertClient = new MediaConvertClient({ 
  region: env.AWS_REGION,
  endpoint: env.MEDIACONVERT_ENDPOINT 
});

export async function processVideoUpload(fastify: FastifyInstance) {
  fastify.post('/upload', async (request, reply) => {
    try {
      const data = await request.file();
      
      if (!data) {
        throw new Error('No file uploaded');
      }

      const key = `${data.filename}`;
      let totalBytesReceived = 0;
      const totalBytes = parseInt(request.headers['content-length'] || '0');

      // Create a pass-through stream to track bytes
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        totalBytesReceived += chunk.length;
        request.log.info(`Received chunk: ${chunk.length} bytes (${totalBytesReceived}/${totalBytes} total)`);
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);

      process.nextTick(async () => {
        await new Promise<void>(async (resolve, _) => {
          request.log.info("Uploading...")
          
          // Upload to S3
          await s3Client.send(new PutObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            Body: fileBuffer,
            ContentType: data.mimetype
          }));

          request.log.info(`Uploaded ${key}`)

          // Create MediaConvert job
          const jobParams: CreateJobCommandInput = {
            Role: env.MEDIACONVERT_ROLE,
            Settings: {
              TimecodeConfig: {
                Source: "ZEROBASED"
              },
              OutputGroups: [{
                Name: "Apple HLS",
                Outputs: [{
                  ContainerSettings: {
                    Container: "M3U8",
                    M3u8Settings: {}
                  },
                  VideoDescription: {
                    Width: 1080,
                    Height: 1920,
                    CodecSettings: {
                      Codec: "H_264",
                      H264Settings: {
                        ParNumerator: 1,
                        FramerateDenominator: 1,
                        MaxBitrate: 12000,
                        ParDenominator: 1,
                        FramerateControl: "SPECIFIED",
                        RateControlMode: "QVBR",
                        FramerateNumerator: 60,
                        SaliencyAwareEncoding: "PREFERRED",
                        SceneChangeDetect: "TRANSITION_DETECTION",
                        ParControl: "SPECIFIED"
                      }
                    }
                  },
                  AudioDescriptions: [{
                    AudioSourceName: "Audio Selector 1",
                    CodecSettings: {
                      Codec: "AAC",
                      AacSettings: {
                        Bitrate: 320000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 96000
                      }
                    }
                  }],
                  OutputSettings: {
                    HlsSettings: {}
                  },
                  NameModifier: "_1080pv"
                }],
                OutputGroupSettings: {
                  Type: "HLS_GROUP_SETTINGS",
                  HlsGroupSettings: {
                    SegmentLength: 10,
                    Destination: "s3://cm-virtu-convert-out/",
                    DestinationSettings: {
                      S3Settings: {
                        Encryption: {
                          EncryptionType: "SERVER_SIDE_ENCRYPTION_S3"
                        },
                        StorageClass: "STANDARD"
                      }
                    },
                    MinSegmentLength: 0
                  }
                }
              }],
              FollowSource: 1,
              Inputs: [{
                AudioSelectors: {
                  "Audio Selector 1": {
                    Tracks: [1],
                    DefaultSelection: "DEFAULT",
                    SelectorType: "TRACK"
                  }
                },
                VideoSelector: {},
                TimecodeSource: "ZEROBASED",
                FileInput: `s3://${env.S3_BUCKET}/${key}`
              }]
            }
          };

          const job = await mediaConvertClient.send(new CreateJobCommand(jobParams));

          let jobStatus;
          do {
            const getJobResponse = await mediaConvertClient.send(new GetJobCommand({
              Id: job.Job?.Id
            }));
            jobStatus = getJobResponse.Job?.Status;
            if (jobStatus !== 'COMPLETE') {
              // Wait 5 seconds before checking again
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          } while (jobStatus !== 'COMPLETE' && jobStatus !== 'ERROR');
  
          if (jobStatus === 'ERROR') {
            throw new Error('MediaConvert job failed');
          }
  
          await s3Client.send(new DeleteObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key
          }));

          await db.insertInto("videos").values({
            key: `${key}.m3u8`
          }).execute();

          resolve();
        });
      });

      return reply.status(200);
    } catch (error) {
      request.log.error(error);
      throw error;
    }
  });

  fastify.get('/videos', async (request, reply) => {
    try {
      const videos = await db
        .selectFrom('videos')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();

      return reply.send({ videos });
    } catch (error) {
      console.error('Error fetching videos:', error);
      return reply.status(500).send({ error: 'Failed to fetch videos' });
    }
  });
} 