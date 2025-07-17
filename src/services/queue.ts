import Bull from 'bull';
import { createClient } from 'redis';
import { QAPipelineService, QARequest, QAResponse } from './qa-pipeline';
import logger from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

export interface QAJobData extends QARequest {
  priority?: number;
  attempts?: number;
  delay?: number;
}

export interface QAJobResult extends QAResponse {
  jobId: string;
  processedAt: Date;
}

export class QueueService {
  private redis!: ReturnType<typeof createClient>;
  private qaQueue!: Bull.Queue<QAJobData>;
  private qaPipeline: QAPipelineService;

  constructor() {
    this.qaPipeline = new QAPipelineService();
    this.setupRedis();
    this.setupQueue();
  }

  private setupRedis(): void {
    let redisConfig: any;
    
    if (process.env.REDIS_URL) {
      redisConfig = { url: process.env.REDIS_URL };
    } else {
      redisConfig = {
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
        password: process.env.REDIS_PASSWORD || undefined,
      };
    }

    this.redis = createClient(redisConfig);
    
    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis');
    });
  }

  private setupQueue(): void {
    let redisConfig: any;
    
    if (process.env.REDIS_URL) {
      // Bull expects Redis URL in a specific format
      redisConfig = process.env.REDIS_URL;
    } else {
      redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      };
      
      // Only add password if it exists
      if (process.env.REDIS_PASSWORD) {
        redisConfig.password = process.env.REDIS_PASSWORD;
      }
    }

    this.qaQueue = new Bull('qa-processing', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.setupQueueProcessors();
    this.setupQueueEvents();
  }

  private setupQueueProcessors(): void {
    // Process QA requests with concurrency
    this.qaQueue.process('qa-request', 5, async (job) => {
      logger.info(`Processing QA job ${job.id} for user ${job.data.userId}`);
      
      try {
        const result = await this.qaPipeline.processQuestion(job.data);
        
        return {
          ...result,
          jobId: job.id?.toString() || 'unknown',
          processedAt: new Date()
        } as QAJobResult;
      } catch (error) {
        logger.error(`Error processing QA job ${job.id}:`, error);
        throw error;
      }
    });

    // Process high-priority requests first
    this.qaQueue.process('qa-request-priority', 3, async (job) => {
      logger.info(`Processing priority QA job ${job.id} for user ${job.data.userId}`);
      
      try {
        const result = await this.qaPipeline.processQuestion(job.data);
        
        return {
          ...result,
          jobId: job.id?.toString() || 'unknown',
          processedAt: new Date()
        } as QAJobResult;
      } catch (error) {
        logger.error(`Error processing priority QA job ${job.id}:`, error);
        throw error;
      }
    });
  }

  private setupQueueEvents(): void {
    this.qaQueue.on('completed', (job, result) => {
      logger.info(`QA job ${job.id} completed for user ${job.data.userId}`);
    });

    this.qaQueue.on('failed', (job, error) => {
      logger.error(`QA job ${job.id} failed for user ${job.data.userId}:`, error);
    });

    this.qaQueue.on('stalled', (job) => {
      logger.warn(`QA job ${job.id} stalled for user ${job.data.userId}`);
    });

    this.qaQueue.on('progress', (job, progress) => {
      logger.debug(`QA job ${job.id} progress: ${progress}%`);
    });
  }

  async addQAJob(
    data: QAJobData,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
      highPriority?: boolean;
    } = {}
  ): Promise<Bull.Job<QAJobData>> {
    const {
      priority = 0,
      delay = 0,
      attempts = 3,
      highPriority = false
    } = options;

    const jobType = highPriority ? 'qa-request-priority' : 'qa-request';
    
    const job = await this.qaQueue.add(jobType, data, {
      priority,
      delay,
      attempts,
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    logger.info(`Added QA job ${job.id} for user ${data.userId} (type: ${jobType})`);
    return job;
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: QAJobResult;
    error?: string;
  }> {
    try {
      const job = await this.qaQueue.getJob(jobId);
      
      if (!job) {
        return { status: 'not_found', progress: 0 };
      }

      const state = await job.getState();
      const progress = job.progress();
      
      if (state === 'completed') {
        return {
          status: 'completed',
          progress: 100,
          result: job.returnvalue
        };
      }

      if (state === 'failed') {
        return {
          status: 'failed',
          progress: 0,
          error: job.failedReason || 'Unknown error'
        };
      }

      return {
        status: state,
        progress: typeof progress === 'number' ? progress : 0
      };
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      return { status: 'error', progress: 0, error: 'Failed to get job status' };
    }
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.qaQueue.getJob(jobId);
      
      if (!job) {
        return false;
      }

      await job.remove();
      logger.info(`Cancelled job ${jobId}`);
      return true;
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error);
      return false;
    }
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.qaQueue.getWaiting(),
        this.qaQueue.getActive(),
        this.qaQueue.getCompleted(),
        this.qaQueue.getFailed(),
        this.qaQueue.getDelayed()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: 0
      };
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0
      };
    }
  }

  async checkUserRateLimit(userId: string, guildId: string): Promise<{
    allowed: boolean;
    remainingRequests: number;
    resetTime: number;
  }> {
    try {
      const key = `rate_limit:${guildId}:${userId}`;
      const windowMs = 60 * 60 * 1000; // 1 hour
      const maxRequests = 10; // Max 10 requests per hour per user
      
      const now = Date.now();
      const windowStart = now - windowMs;

      // Get current request count for this user in this window
      const requests = await this.redis.zRangeByScore(key, windowStart, now);
      const currentCount = requests.length;

      if (currentCount >= maxRequests) {
        // Get the oldest request time to calculate reset time
        const oldestRequest = await this.redis.zRange(key, 0, 0, { REV: false });
        const resetTime = oldestRequest.length > 0 ? 
          parseInt(oldestRequest[0] as string) + windowMs : now + windowMs;

        return {
          allowed: false,
          remainingRequests: 0,
          resetTime
        };
      }

      // Add current request
      await this.redis.zAdd(key, [{ score: now, value: now.toString() }]);
      
      // Clean up old requests
      await this.redis.zRemRangeByScore(key, 0, windowStart);
      
      // Set expiration for the key
      await this.redis.expire(key, Math.ceil(windowMs / 1000));

      return {
        allowed: true,
        remainingRequests: maxRequests - currentCount - 1,
        resetTime: now + windowMs
      };
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      // Allow request if rate limit check fails
      return {
        allowed: true,
        remainingRequests: 10,
        resetTime: Date.now() + 60 * 60 * 1000
      };
    }
  }

  async pauseQueue(): Promise<void> {
    await this.qaQueue.pause();
    logger.info('Queue paused');
  }

  async resumeQueue(): Promise<void> {
    await this.qaQueue.resume();
    logger.info('Queue resumed');
  }

  async clearQueue(): Promise<void> {
    await this.qaQueue.empty();
    logger.info('Queue cleared');
  }

  async close(): Promise<void> {
    await this.qaQueue.close();
    await this.redis.quit();
    logger.info('Queue service closed');
  }
}