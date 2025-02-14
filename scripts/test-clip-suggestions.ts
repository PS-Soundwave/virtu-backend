import { db } from '../src/db/index.js';
import { v4 as uuidv4 } from 'uuid';

async function createTestVideo() {
  // Create a test video
  const videoId = uuidv4();
  const userId = uuidv4();

  // Create test user if doesn't exist
  await db.insertInto('users')
    .values({
      id: userId,
      firebase_id: `test-firebase-id-${Date.now()}`,
      username: `test-user-${Date.now()}`
    })
    .execute();

  // Create test video
  await db.insertInto('videos')
    .values({
      id: videoId,
      key: 'test-video',
      uploader: userId,
      thumbnail_key: 'test-thumbnail'
    })
    .execute();

  // Create test subtitles (simulating a podcast/long-form video)
  const subtitles = [
    // Opening segment
    {
      video_id: videoId,
      start_time: 0,
      end_time: 5,
      text: "Welcome to our tech podcast! Today we'll be discussing AI and machine learning."
    },
    // Funny story 1
    {
      video_id: videoId,
      start_time: 5,
      end_time: 15,
      text: "But first, let me tell you this hilarious story about a bug I encountered yesterday."
    },
    {
      video_id: videoId,
      start_time: 15,
      end_time: 25,
      text: "So I was debugging this code, and you won't believe what happened - the AI started generating cat pictures instead of graphs! [laughing]"
    },
    {
      video_id: videoId,
      start_time: 25,
      end_time: 30,
      text: "Everyone in the office was crying with laughter when they saw the output!"
    },
    // Technical segment
    {
      video_id: videoId,
      start_time: 30,
      end_time: 40,
      text: "On a more serious note, let's dive into the technical details of transformer architectures."
    },
    {
      video_id: videoId,
      start_time: 40,
      end_time: 50,
      text: "The key innovation in transformers is the self-attention mechanism, which allows the model to weigh different parts of the input differently."
    },
    // Controversial segment
    {
      video_id: videoId,
      start_time: 50,
      end_time: 60,
      text: "This is actually quite controversial in the field, as some researchers argue that simpler architectures could achieve similar results."
    },
    {
      video_id: videoId,
      start_time: 60,
      end_time: 65,
      text: "I personally think the whole transformer architecture is overrated, but that's just my opinion."
    },
    // Funny story 2
    {
      video_id: videoId,
      start_time: 65,
      end_time: 75,
      text: "Oh no! I just realized I forgot to turn off my test deployment! [panicked laughter] This is a disaster waiting to happen!"
    },
    {
      video_id: videoId,
      start_time: 75,
      end_time: 85,
      text: "You should have seen my face when I saw the AWS bill! I thought I was going to faint! [laughing]"
    },
    // Closing
    {
      video_id: videoId,
      start_time: 85,
      end_time: 90,
      text: "But seriously folks, always remember to check your production configs. That's a pro tip right there."
    }
  ];

  for (const subtitle of subtitles) {
    await db.insertInto('subtitles')
      .values(subtitle)
      .execute();
  }

  console.log(`Created test video with ID: ${videoId}`);
  return videoId;
}

createTestVideo()
  .then(videoId => {
    console.log('Test data created successfully');
    console.log('Try these example requests:');
    console.log(`curl "http://localhost:3000/video/${videoId}/suggest-clips?prompt=funny%20moments"`);
    console.log(`curl "http://localhost:3000/video/${videoId}/suggest-clips?prompt=technical%20explanations"`);
    console.log(`curl "http://localhost:3000/video/${videoId}/suggest-clips?prompt=controversial%20statements"`);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
