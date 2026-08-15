/**
 * E2E Test: User Profile Editing
 * 
 * Tests the complete flow of editing user profile through the API,
 * including basic info, preferences, and load anchors.
 */

import { describe, it, expect, beforeAll, afterAll } from 'node:test';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:43111';
const TEST_USER_ID = `test_e2e_${Date.now()}`;

let authToken = '';

async function createTestUser() {
  const response = await fetch(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: TEST_USER_ID,
      name: 'E2E Test User',
      created_at: Date.now()
    })
  });
  return response.ok;
}

async function getAuthToken() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin'
    })
  });
  if (response.ok) {
    const data = await response.json();
    authToken = data.token;
  }
}

async function getProfile(userId) {
  const response = await fetch(`${BASE_URL}/api/profiles/${userId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  if (response.ok) {
    return await response.json();
  }
  return null;
}

async function updateProfile(userId, data) {
  const response = await fetch(`${BASE_URL}/api/profiles/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(data)
  });
  if (response.ok) {
    return await response.json();
  }
  throw new Error(`Update failed: ${response.statusText}`);
}

async function deleteLoadAnchor(userId, exerciseId) {
  const response = await fetch(`${BASE_URL}/api/profiles/${userId}/anchors/${exerciseId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  return response.ok;
}

async function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('E2E: User Profile Editing', () => {
  beforeAll(async () => {
    console.log('Setting up E2E test environment...');
    await getAuthToken();
    await createTestUser();
    console.log('E2E test environment ready');
  });

  afterAll(async () => {
    console.log('Cleaning up E2E test environment...');
  });

  it('should create a new user profile', async () => {
    const profile = await getProfile(TEST_USER_ID);
    expect(profile).not.toBeNull();
    expect(profile.user_id).toBe(TEST_USER_ID);
  });

  it('should update basic_info', async () => {
    const updateData = {
      basic_info: {
        age: 28,
        weight: 75,
        height: 175,
        body_fat: 15,
        training_age: 3
      },
      modifiedBy: 'admin',
      changeReason: 'E2E test: updating basic info'
    };

    await updateProfile(TEST_USER_ID, updateData);

    const profile = await getProfile(TEST_USER_ID);
    const basicInfo = typeof profile.basic_info === 'string' 
      ? JSON.parse(profile.basic_info) 
      : profile.basic_info;
    
    expect(basicInfo.age).toBe(28);
    expect(basicInfo.weight).toBe(75);
    expect(basicInfo.height).toBe(175);
  });

  it('should update preferences with equipment and avoid_exercises', async () => {
    const updateData = {
      preferences: {
        goal: '增肌',
        equipment: ['哑铃', '杠铃', '壶铃'],
        avoid_exercises: ['深蹲', '硬拉']
      },
      modifiedBy: 'admin',
      changeReason: 'E2E test: updating preferences'
    };

    await updateProfile(TEST_USER_ID, updateData);

    const profile = await getProfile(TEST_USER_ID);
    const preferences = typeof profile.preferences === 'string' 
      ? JSON.parse(profile.preferences) 
      : profile.preferences;
    
    expect(preferences.goal).toBe('增肌');
    expect(preferences.equipment).toEqual(['哑铃', '杠铃', '壶铃']);
    expect(preferences.avoid_exercises).toEqual(['深蹲', '硬拉']);
  });

  it('should update load anchors', async () => {
    const updateData = {
      load_anchors: {
        'bench_press': { '1rm': 80, current: 60, last_updated: Date.now() },
        'squat': { '1rm': 100, current: 80, last_updated: Date.now() },
        'deadlift': { '1rm': 120, current: 100, last_updated: Date.now() }
      },
      modifiedBy: 'admin',
      changeReason: 'E2E test: updating load anchors'
    };

    await updateProfile(TEST_USER_ID, updateData);

    const profile = await getProfile(TEST_USER_ID);
    const loadAnchors = typeof profile.load_anchors === 'string' 
      ? JSON.parse(profile.load_anchors) 
      : profile.load_anchors;
    
    expect(loadAnchors['bench_press']['1rm']).toBe(80);
    expect(loadAnchors['squat']['1rm']).toBe(100);
    expect(loadAnchors['deadlift']['1rm']).toBe(120);
  });

  it('should delete a load anchor', async () => {
    const exerciseId = 'bench_press';
    
    const success = await deleteLoadAnchor(TEST_USER_ID, exerciseId);
    expect(success).toBe(true);

    await waitFor(500);

    const profile = await getProfile(TEST_USER_ID);
    const loadAnchors = typeof profile.load_anchors === 'string' 
      ? JSON.parse(profile.load_anchors) 
      : profile.load_anchors;
    
    expect(loadAnchors[exerciseId]).toBeUndefined();
  });

  it('should merge load anchors when replaceAnchors is false', async () => {
    const updateData1 = {
      load_anchors: {
        'bench_press': { '1rm': 80, current: 60, last_updated: Date.now() }
      },
      modifiedBy: 'admin',
      replaceAnchors: false
    };

    await updateProfile(TEST_USER_ID, updateData1);

    const updateData2 = {
      load_anchors: {
        'squat': { '1rm': 100, current: 80, last_updated: Date.now() }
      },
      modifiedBy: 'admin',
      replaceAnchors: false
    };

    await updateProfile(TEST_USER_ID, updateData2);

    const profile = await getProfile(TEST_USER_ID);
    const loadAnchors = typeof profile.load_anchors === 'string' 
      ? JSON.parse(profile.load_anchors) 
      : profile.load_anchors;
    
    expect(loadAnchors['bench_press']['1rm']).toBe(80);
    expect(loadAnchors['squat']['1rm']).toBe(100);
  });

  it('should replace load anchors when replaceAnchors is true', async () => {
    const updateData = {
      load_anchors: {
        'bench_press': { '1rm': 85, current: 65, last_updated: Date.now() }
      },
      modifiedBy: 'admin',
      replaceAnchors: true
    };

    await updateProfile(TEST_USER_ID, updateData);

    const profile = await getProfile(TEST_USER_ID);
    const loadAnchors = typeof profile.load_anchors === 'string' 
      ? JSON.parse(profile.load_anchors) 
      : profile.load_anchors;
    
    expect(loadAnchors['bench_press']['1rm']).toBe(85);
    expect(loadAnchors['squat']).toBeUndefined();
  });

  it('should handle fitness_level in lowercase format', async () => {
    const updateData = {
      fitness_level: 'intermediate',
      modifiedBy: 'admin',
      changeReason: 'E2E test: updating fitness level'
    };

    await updateProfile(TEST_USER_ID, updateData);

    const profile = await getProfile(TEST_USER_ID);
    expect(profile.fitness_level).toBe('intermediate');
  });
});
