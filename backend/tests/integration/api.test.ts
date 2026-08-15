import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { createServer } from '../../src/server.js';

describe('User Profile API Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = createServer();
  });

  afterAll(async () => {
    if (app && app.close) {
      await app.close();
    }
  });

  describe('GET /api/profiles/:userId', () => {
    it('should return user profile', async () => {
      const response = await request(app)
        .get('/api/profiles/test20260115')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('user_id', 'test20260115');
      expect(response.body).toHaveProperty('basic_info');
      expect(response.body).toHaveProperty('preferences');
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/profiles/non-existent-user')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/profiles/:userId', () => {
    const testUserId = 'integration-test-user-' + Date.now();

    beforeAll(async () => {
      await request(app)
        .post('/api/profiles')
        .send({ userId: testUserId, basic_info: { age: 30 } })
        .expect(201);
    });

    it('should update user profile', async () => {
      const updateData = {
        basic_info: { age: 35, height: 180, weight: 75 },
        preferences: { goal: '增肌', duration: 60 },
        load_anchors: {
          bench_press: { '1rm': 80, current: 75 }
        },
        modifiedBy: 'admin',
        changeReason: 'Integration test'
      };

      const response = await request(app)
        .put(`/api/profiles/${testUserId}`)
        .send(updateData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        message: 'User profile updated successfully',
        userId: testUserId
      });
    });

    it('should persist data to database', async () => {
      const updateData = {
        basic_info: { age: 40, height: 185 },
        modifiedBy: 'admin'
      };

      await request(app)
        .put(`/api/profiles/${testUserId}`)
        .send(updateData)
        .expect(200);

      const getResponse = await request(app)
        .get(`/api/profiles/${testUserId}`)
        .expect(200);

      expect(getResponse.body.basic_info).toEqual(updateData.basic_info);
    });

    it('should return 400 for invalid data', async () => {
      const response = await request(app)
        .put(`/api/profiles/${testUserId}`)
        .send({ invalid: 'data' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should merge load anchors', async () => {
      const firstUpdate = {
        load_anchors: { bench_press: { '1rm': 80 } },
        modifiedBy: 'admin'
      };

      await request(app)
        .put(`/api/profiles/${testUserId}`)
        .send(firstUpdate)
        .expect(200);

      const secondUpdate = {
        load_anchors: { squat: { '1rm': 100 } },
        modifiedBy: 'admin'
      };

      await request(app)
        .put(`/api/profiles/${testUserId}`)
        .send(secondUpdate)
        .expect(200);

      const response = await request(app)
        .get(`/api/profiles/${testUserId}`)
        .expect(200);

      expect(response.body.load_anchors).toEqual({
        bench_press: { '1rm': 80 },
        squat: { '1rm': 100 }
      });
    });
  });

  describe('POST /api/profiles', () => {
    it('should create new user profile', async () => {
      const newUserId = 'new-user-' + Date.now();
      const newProfile = {
        userId: newUserId,
        basic_info: { age: 25, height: 170 },
        preferences: { goal: '减脂' },
        modifiedBy: 'admin'
      };

      const response = await request(app)
        .post('/api/profiles')
        .send(newProfile)
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('user_id', newUserId);

      const getResponse = await request(app)
        .get(`/api/profiles/${newUserId}`)
        .expect(200);

      expect(getResponse.body.basic_info).toEqual(newProfile.basic_info);
    });

    it('should return 400 for duplicate user', async () => {
      const userId = 'duplicate-test-' + Date.now();
      const profile = {
        userId,
        basic_info: { age: 30 },
        modifiedBy: 'admin'
      };

      await request(app)
        .post('/api/profiles')
        .send(profile)
        .expect(201);

      await request(app)
        .post('/api/profiles')
        .send(profile)
        .expect(400);
    });
  });
});
