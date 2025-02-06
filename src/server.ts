import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { processVideoUpload } from './routes/video.js';

const fastify = Fastify({
  logger: true
});

// Register multipart for file uploads
fastify.register(multipart, {
  limits: {
    fileSize: 1000 * 1024 * 1024 // 1GB limit
  }
});

// Register routes
fastify.register(processVideoUpload);

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
  }
};

start(); 