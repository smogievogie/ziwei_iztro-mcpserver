#!/usr/bin/env node

// 启动脚本，用于启动iztro MCP服务器
const { spawn } = require('child_process');
const path = require('path');

// 启动MCP服务器进程
const serverProcess = spawn('node', [path.join(__dirname, 'dist', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// 监听服务器输出
serverProcess.stdout.on('data', (data) => {
  process.stdout.write(data);
});

serverProcess.stderr.on('data', (data) => {
  process.stderr.write(data);
});

// 监听服务器退出
serverProcess.on('close', (code) => {
  console.log(`MCP服务器已退出，退出码: ${code}`);
});

// 处理进程信号
process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  serverProcess.kill('SIGTERM');
});