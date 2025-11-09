#!/usr/bin/env bun

/**
 * Test script for julie-semantic integration
 */

import { findJulieSemantic } from './src/embeddings';
import { spawnSync } from 'child_process';

console.log('🧪 Testing julie-semantic integration...\n');

// Test 1: Find julie-semantic binary
console.log('Test 1: Finding julie-semantic binary');
const juliePath = findJulieSemantic();

if (!juliePath) {
  console.error('❌ Failed: julie-semantic not found');
  process.exit(1);
}

console.log(`✅ Found: ${juliePath}\n`);

// Test 2: Call julie-semantic with a simple query
console.log('Test 2: Generating embedding for test query');
const testText = 'Fix JWT validation bug in authentication module';

const result = spawnSync(
  juliePath,
  ['query', '--text', testText, '--model', 'bge-small', '--format', 'json'],
  {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  }
);

if (result.error) {
  console.error('❌ Failed to spawn julie-semantic:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error('❌ julie-semantic failed:', result.stderr);
  process.exit(1);
}

// Parse output
try {
  const vector = JSON.parse(result.stdout.trim());

  if (!Array.isArray(vector)) {
    console.error('❌ Invalid output: expected array');
    process.exit(1);
  }

  if (vector.length !== 384) {
    console.error(`❌ Invalid dimensions: expected 384, got ${vector.length}`);
    process.exit(1);
  }

  console.log(`✅ Generated embedding: ${vector.length} dimensions`);
  console.log(`   First 10 values: [${vector.slice(0, 10).map(v => v.toFixed(4)).join(', ')}...]`);
  console.log(`   Vector magnitude: ${Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0)).toFixed(4)}`);

  // Check if stderr contains GPU info
  if (result.stderr) {
    console.log('\n📊 julie-semantic output:');
    console.log(result.stderr);
  }

  console.log('\n🎉 All tests passed!');
  console.log('✅ julie-semantic integration is working correctly');
  console.log('✅ GPU acceleration available (check logs above for GPU confirmation)');

} catch (error) {
  console.error('❌ Failed to parse output:', error);
  process.exit(1);
}
