import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { registerVideoRoutes } from './routes/video.js';
import { userRoutes } from './routes/user.js';

const fastify = Fastify({
  logger: true
});

fastify.addHook("onRequest", async (request, reply) => {
	reply.header("Access-Control-Allow-Origin", "*");
	reply.header("Access-Control-Allow-Credentials", true);
	reply.header("Access-Control-Allow-Headers", "Authorization, Origin, X-Requested-With, Content-Type, Accept, X-Slug, X-UID");
	reply.header("Access-Control-Allow-Methods", "OPTIONS, POST, PUT, PATCH, GET, DELETE");
	if (request.method === "OPTIONS") {
		reply.send();
	}
});

// Register multipart for file uploads
fastify.register(multipart, {
  limits: {
    fileSize: 1000 * 1024 * 1024 // 1GB limit
  }
});

// Register routes
fastify.register(registerVideoRoutes);
fastify.register(userRoutes);

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
  }
};

start(); 