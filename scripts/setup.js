#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function copyExampleFiles() {
  const files = [
    { src: '.env.example', dest: '.env' },
    { src: 'iztro-mcp-config.example.json', dest: 'iztro-mcp-config.json' }
  ];

  files.forEach(({ src, dest }) => {
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log(`✅ 已创建 ${dest}`);
    }
  });
}

function promptForApiKey() {
  console.log('\n🔧 iztro MCP Server 配置向导\n');
  console.log('本项目需要高德地图API密钥来提供地理编码服务。');
  console.log('\n获取API密钥步骤：');
  console.log('1. 访问 https://lbs.amap.com/');
  console.log('2. 注册并登录账号');
  console.log('3. 创建应用，选择「Web服务」类型');
  console.log('4. 获取API Key\n');

  rl.question('请输入您的高德地图API密钥（留空跳过）: ', (apiKey) => {
    if (apiKey.trim()) {
      // 更新 .env 文件
      if (fs.existsSync('.env')) {
        let envContent = fs.readFileSync('.env', 'utf8');
        envContent = envContent.replace(
          /AMAP_API_KEY=.*/,
          `AMAP_API_KEY=${apiKey.trim()}`
        );
        fs.writeFileSync('.env', envContent);
        console.log('✅ 已更新 .env 文件');
      }

      // 更新配置文件
      if (fs.existsSync('iztro-mcp-config.json')) {
        try {
          const config = JSON.parse(fs.readFileSync('iztro-mcp-config.json', 'utf8'));
          config.amapApiKey = apiKey.trim();
          fs.writeFileSync('iztro-mcp-config.json', JSON.stringify(config, null, 2));
          console.log('✅ 已更新 iztro-mcp-config.json 文件');
        } catch (error) {
          console.log('⚠️  配置文件格式错误，请手动编辑');
        }
      }

      console.log('\n🎉 配置完成！现在可以运行 npm start 启动服务器。');
    } else {
      console.log('\n⚠️  跳过API密钥配置。');
      console.log('请手动编辑 .env 或 iztro-mcp-config.json 文件添加您的API密钥。');
    }

    console.log('\n📖 更多信息请查看 README.md 文件。');
    rl.close();
  });
}

function main() {
  console.log('🚀 正在设置 iztro MCP Server...');
  
  copyExampleFiles();
  
  // 检查是否已经配置了API密钥
  let hasApiKey = false;
  
  if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    hasApiKey = envContent.includes('AMAP_API_KEY=') && 
                !envContent.includes('your_amap_api_key_here');
  }
  
  if (hasApiKey) {
    console.log('✅ 检测到已配置的API密钥，跳过配置向导。');
    console.log('🎉 设置完成！现在可以运行 npm start 启动服务器。');
    rl.close();
  } else {
    promptForApiKey();
  }
}

if (require.main === module) {
  main();
}

module.exports = { copyExampleFiles, promptForApiKey };