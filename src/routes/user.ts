import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { authenticateRequest } from '../middleware/auth.js';
import { Video } from './video.js';

type SearchQueryParams = {
  q: string;
}

type GetUserQueryParams = {
  username: string;
}

type User = {
  username: string;
  id: string;
}

export async function userRoutes(fastify: FastifyInstance) {
  // Search users by username
  fastify.get<{Querystring: SearchQueryParams, Reply: User[]}>('/user/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const query = decodeURIComponent(request.query.q).trim();
      
      // Basic input validation
      if (!query || query.length < 1) {
        return reply.status(400).send();
      }

      // Escape special characters for LIKE query
      const escapedQuery = query.replace(/[%_]/g, '\\$&');
      
      // Get username suggestions
      const suggestions = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('username', 'like', `${escapedQuery}%`) // Starts with query
        .orderBy('username')
        .limit(10)
        .execute();

      return reply.status(200).send(suggestions);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send();
    }
  });

  // Validate username availability
  fastify.get<{Querystring: GetUserQueryParams, Reply: User}>('/user', {
    schema: {
      querystring: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const username = decodeURIComponent(request.query.username).trim();

      // Check if username exists
      const existingUser = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('username', '=', username)
        .executeTakeFirst();

      if (!existingUser) {
        return reply.status(404).send();
      }

      return reply.status(200).send(existingUser);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send();
    }
  });

  // Get current user
  fastify.get<{Reply: User}>('/user/me', { 
    preHandler: authenticateRequest 
  }, async (request, reply) => {
    try {
      const user = await db
        .selectFrom('users')
        .select(['username', 'id'])
        .where('firebase_id', '=', request.uid!)
        .executeTakeFirst();

      if (!user) {
        return reply.status(404).send();
      }

      return reply.status(200).send(user);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send();
    }
  });

  // Update or create user
  fastify.patch<{Body: { username: string }}>('/user/me', {
    preHandler: authenticateRequest,
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const firebaseUid = request.uid!;
      const { username } = request.body;

      // Check if username is already taken by another user
      const existingUser = await db
        .selectFrom('users')
        .select(['firebase_id'])
        .where('username', '=', username)
        .executeTakeFirst();

      if (existingUser && existingUser.firebase_id !== firebaseUid) {
        return reply.status(409).send();
      }

      // Upsert user
      await db
        .insertInto('users')
        .values({
          firebase_id: firebaseUid,
          username
        })
        .onConflict(oc => oc
          .column('firebase_id')
          .doUpdateSet({ username })
        )
        .execute();
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send();
    }
  });

  // Get videos uploaded by a specific user
  fastify.get<{Params: { userId: string }, Reply: Video[]}>('/user/:userId/video', async (request, reply) => {
    const videos = await db
      .selectFrom('videos')
      .where('uploader', '=', request.params.userId)
      .where('visibility', '=', 'public')
      .select(['id', 'key', 'thumbnail_key', 'visibility'])
      .orderBy('created_at', 'desc')
      .execute();

    return reply.status(200).send(videos);
  });

  // Get all videos (public and private) for the authenticated user
  fastify.get<{Reply: Video[]}>('/user/me/video', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const user = await db.selectFrom('users')
      .select(['id'])
      .where('firebase_id', '=', request.uid!)
      .executeTakeFirst();

    if (!user) {
      reply.status(401).send();
      return;
    }

    const videos = await db
      .selectFrom('videos')
      .where('uploader', '=', user.id)
      .select(['id', 'key', 'thumbnail_key', 'visibility'])
      .orderBy('created_at', 'desc')
      .execute();

    return reply.status(200).send(videos);
  });

  fastify.register(async function (fastify) {
    fastify.addHook('preHandler', authenticateRequest);

    // Follow a user
    fastify.post<{
      Params: { userId: string };
    }>('/user/:userId/follows', async (request, reply) => {
      try {
        // Get the current user's ID
        const follower = await db
          .selectFrom('users')
          .where('firebase_id', '=', request.uid!)
          .select(['id'])
          .executeTakeFirst();

        if (!follower) {
          return reply.status(401).send();
        }

        // Check if the user to follow exists
        const followed = await db
          .selectFrom('users')
          .where('id', '=', request.params.userId)
          .select(['id'])
          .executeTakeFirst();

        if (!followed) {
          return reply.status(404).send();
        }

        // Prevent self-following
        if (follower.id === followed.id) {
          return reply.status(400).send();
        }

        // Create the follow relationship
        await db
          .insertInto('follows')
          .values({
            follower_id: follower.id,
            followed_id: followed.id
          })
          .execute();

        return reply.status(201).send();
      } catch (error: any) {
        request.log.error(error);

        // Handle unique constraint violation
        if (error.code === '23505') {
          return reply.status(400).send();
        }
        
        return reply.status(500).send();
      }
    });

    // Unfollow a user
    fastify.delete<{
      Params: { userId: string };
    }>('/user/:userId/follows', async (request, reply) => {
      try {
        // Get the current user's ID
        const follower = await db
          .selectFrom('users')
          .where('firebase_id', '=', request.uid!)
          .select(['id'])
          .executeTakeFirst();

        if (!follower) {
          return reply.status(401).send();
        }

        // Delete the follow relationship
        const result = await db
          .deleteFrom('follows')
          .where('follower_id', '=', follower.id)
          .where('followed_id', '=', request.params.userId)
          .execute();

        if (result.length === 0) {
          return reply.status(404).send();
        }

        return reply.status(200).send();
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send();
      }
    });

    // Get follow counts for a user
    fastify.get<{
      Params: { userId: string };
    }>('/user/:userId/follows', async (request, reply) => {
      try {
        // Get the current user's ID
        const currentUser = await db
          .selectFrom('users')
          .where('firebase_id', '=', request.uid!)
          .select(['id'])
          .executeTakeFirst();

        if (!currentUser) {
          return reply.status(401).send();
        }

        const [followers, following, isFollowing] = await Promise.all([
          // Count followers
          db.selectFrom('follows')
            .where('followed_id', '=', request.params.userId)
            .select(({ fn }) => [
              fn.countAll().as('count')
            ])
            .executeTakeFirst(),
          
          // Count following
          db.selectFrom('follows')
            .where('follower_id', '=', request.params.userId)
            .select(({ fn }) => [
              fn.countAll().as('count')
            ])
            .executeTakeFirst(),

          // Check if current user is following the requested user
          db.selectFrom('follows')
            .where('follower_id', '=', currentUser.id)
            .where('followed_id', '=', request.params.userId)
            .selectAll()
            .executeTakeFirst()
        ]);

        return reply.status(200).send({
          followers: Number(followers?.count || 0),
          following: Number(following?.count || 0),
          isFollowing: !!isFollowing
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });
  });
}
