#!/usr/bin/env node

// 启动脚本，用于启动iztro MCP服务器
import { astro } from 'iztro';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z, ZodRawShape } from 'zod';
import axios from 'axios';

// 地理编码接口类型
interface GeocodeResult {
  longitude: number;
  latitude: number;
  formatted_address: string;
}

// 配置文件接口
interface Config {
  amapApiKey?: string;
  geocodeProvider?: 'amap' | 'baidu' | 'google';
  timeout?: number;
}

// 读取配置文件
function loadConfig(): Config {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    const configPaths = [
      path.join(process.cwd(), 'iztro-mcp-config.json'),
      path.join(process.cwd(), '.iztro-mcp.json'),
      path.join(os.homedir(), '.iztro-mcp.json')
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, 'utf8');
          return JSON.parse(configContent);
        } catch (error) {
          console.warn(`配置文件 ${configPath} 格式错误:`, error);
        }
      }
    }
  } catch (error) {
    // 如果无法读取配置文件，返回空配置
  }
  
  return {};
}

// 获取API KEY的安全方法
function getApiKey(): string {
  const config = loadConfig();
  
  // 优先级：环境变量 > 配置文件
  const apiKey = process.env.AMAP_API_KEY || config.amapApiKey;
  
  if (!apiKey) {
    throw new Error(`
请配置高德地图API KEY，可通过以下方式之一：
1. 设置环境变量：export AMAP_API_KEY="your_api_key"
2. 创建配置文件 iztro-mcp-config.json：
   {
     "amapApiKey": "your_api_key"
   }
3. 申请API KEY：https://console.amap.com/dev/key/app
`);
  }
  
  return apiKey;
}

// 地理编码函数（使用高德地图API）
async function geocodeLocation(location: string): Promise<GeocodeResult> {
  try {
    // 获取API密钥
    const apiKey = getApiKey();
    const config = loadConfig();
    const timeout = config.timeout || 5000;
    
    // 使用高德地图Web服务API进行地理编码
    const response = await axios.get('https://restapi.amap.com/v3/geocode/geo', {
      params: {
        key: apiKey, // 使用安全的API KEY获取方式
        address: location,
        output: 'json'
      },
      timeout: timeout
    });

    if (response.data.status === '1' && response.data.geocodes && response.data.geocodes.length > 0) {
      const result = response.data.geocodes[0];
      const [longitude, latitude] = result.location.split(',').map(Number);
      return {
        longitude,
        latitude,
        formatted_address: result.formatted_address
      };
    } else {
      throw new Error(`无法找到地点 "${location}" 的地理位置信息`);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`地理编码API调用失败: ${error.message}`);
    }
    throw error;
  }
}

// 真太阳时计算函数
function calculateApparentSolarTime(beijingTime: string, longitude: number): string {
  try {
    const date = new Date(beijingTime);
    if (isNaN(date.getTime())) {
      throw new Error('无效的时间格式');
    }

    // 计算儒略日
    const julianDay = getJulianDay(date);
    
    // 计算时间差方程（均时差）
    const equationOfTime = getEquationOfTime(julianDay);
    
    // 计算地方平太阳时
    const localMeanTime = date.getTime() + (longitude - 120) * 4 * 60 * 1000; // 120°E是北京时间基准经度
    
    // 计算真太阳时
    const apparentSolarTime = new Date(localMeanTime + equationOfTime * 60 * 1000);
    
    // 格式化为本地时间字符串（而不是UTC时间）
    const year = apparentSolarTime.getFullYear();
    const month = String(apparentSolarTime.getMonth() + 1).padStart(2, '0');
    const day = String(apparentSolarTime.getDate()).padStart(2, '0');
    const hours = String(apparentSolarTime.getHours()).padStart(2, '0');
    const minutes = String(apparentSolarTime.getMinutes()).padStart(2, '0');
    const seconds = String(apparentSolarTime.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    throw new Error(`真太阳时计算失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 计算儒略日
function getJulianDay(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();
  
  let a = Math.floor((14 - month) / 12);
  let y = year + 4800 - a;
  let m = month + 12 * a - 3;
  
  let jdn = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  let jd = jdn + (hour - 12) / 24 + minute / 1440 + second / 86400;
  
  return jd;
}

// 计算时间差方程（均时差）- 基于Jean Meeus算法
function getEquationOfTime(julianDay: number): number {
  // 儒略世纪数
  const T = (julianDay - 2451545.0) / 36525.0;
  
  // 平黄道倾角（弧度）
  const epsilon = (84381.406 + T * (-46.836769 + T * (-0.0001831 + T * (0.0020034 + T * (-0.000000576 - T * 0.0000000434))))) * Math.PI / (180 * 3600);
  
  // 几何平黄经（度）
  let L0 = 280.4664567 + T * (36000.76982779 + T * (0.0003032028 + T * (1/49931 - T * (T/15300000 + T/2000000))));
  L0 = ((L0 % 360) + 360) % 360; // 规范化到0-360度
  const L0_rad = L0 * Math.PI / 180;
  
  // 地球轨道离心率
  const e = 0.0167086342 + T * (-0.004203654 + T * (-0.0000126734 + T * (0.000001444 + T * (-0.000000002 + T * 0.000000003))));
  
  // 平近点角（度）
  let M = (1287104.79305 + T * (129596581.0481 + T * (-0.5532 + T * (0.000136 - T * 0.00001149)))) / 3600;
  M = ((M % 360) + 360) % 360; // 规范化到0-360度
  const M_rad = M * Math.PI / 180;
  
  // y = tan²(ε/2)
  const y = Math.tan(epsilon / 2) ** 2;
  
  // 时间差方程（弧度）
  const E_rad = -y * Math.sin(2 * L0_rad) + 
                2 * e * Math.sin(M_rad) - 
                4 * e * y * Math.sin(M_rad) * Math.cos(2 * L0_rad) + 
                0.5 * y * y * Math.sin(4 * L0_rad) + 
                1.25 * e * e * Math.sin(2 * M_rad);
  
  // 转换为分钟
  const E_minutes = 4 * E_rad * 180 / Math.PI;
  
  return E_minutes;
}

// 将小时转换为时辰序号（参考iztro项目的timeToIndex函数）
function getTimeSlotFromHour(hour: number): number {
  // 时辰对应关系，子时分早晚：
  // 早子时: 00:00-01:00 -> 0 (earlyRatHour)
  // 丑时: 01:00-03:00 -> 1 (oxHour)
  // 寅时: 03:00-05:00 -> 2 (tigerHour)
  // 卯时: 05:00-07:00 -> 3 (rabbitHour)
  // 辰时: 07:00-09:00 -> 4 (dragonHour)
  // 巳时: 09:00-11:00 -> 5 (snakeHour)
  // 午时: 11:00-13:00 -> 6 (horseHour)
  // 未时: 13:00-15:00 -> 7 (goatHour)
  // 申时: 15:00-17:00 -> 8 (monkeyHour)
  // 酉时: 17:00-19:00 -> 9 (roosterHour)
  // 戌时: 19:00-21:00 -> 10 (dogHour)
  // 亥时: 21:00-23:00 -> 11 (pigHour)
  // 晚子时: 23:00-00:00 -> 12 (lateRatHour)
  
  if (hour === 0) {
    // 00:00～01:00 为早子时
    return 0;
  }

  if (hour === 23) {
    // 23:00～00:00 为晚子时
    return 12;
  }

  return Math.floor((hour + 1) / 2);
}

// 创建MCP服务器
const server = new McpServer({
  name: 'ziwei_iztro-mcpserver',
  version: '1.0.0',
  instructions: '这个工具可以根据用户的生辰信息生成紫微斗数星盘，支持地理编码和真太阳时转换。需要用户提供生日、出生时辰和性别，可选择提供出生地点进行真太阳时转换。'
});

// 定义地理编码工具的输入参数类型
const GeocodeInputSchema: ZodRawShape = {
  location: z.string().describe('地点名称，如："安徽省合肥市庐江县金牛镇"')
};

// 定义真太阳时转换工具的输入参数类型
const ApparentSolarTimeInputSchema: ZodRawShape = {
  beijingTime: z.string().describe('北京时间，格式为 YYYY-MM-DD HH:mm:ss'),
  longitude: z.number().describe('经度（东经为正，西经为负）'),
  latitude: z.number().optional().describe('纬度（北纬为正，南纬为负，可选参数）')
};

// 定义工具的输入参数类型
const AstrolabeInputSchema: ZodRawShape = {
  birthday: z.string().describe('用户生日，格式为 YYYY-MM-DD'),
  birthTime: z.number().min(0).max(12).describe('出生时辰序号 (0-12)，早子时为0，丑时为1，寅时为2，卯时为3，辰时为4，巳时为5，午时为6，未时为7，申时为8，酉时为9，戌时为10，亥时为11，晚子时为12'),
  gender: z.enum(['男', '女', 'male', 'female']).describe('性别'),
  calendarType: z.enum(['solar', 'lunar', 'gregorian', '阳历', '阴历', '农历']).optional().describe('日历类型：阳历(solar)或农历(lunar)，默认为阳历'),
  isLeapMonth: z.boolean().optional().describe('是否闰月（仅在农历时有效）'),
  language: z.enum(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN']).optional().describe('输出语言'),
  location: z.string().optional().describe('出生地点（可选），如："安徽省合肥市庐江县金牛镇"，提供后将自动进行真太阳时转换')
};

// 注册地理编码工具
server.tool(
  'geocode_location',
  '将地点名称转换为经纬度坐标',
  GeocodeInputSchema,
  async (args) => {
    try {
      const { location } = args || {};
      
      if (!location) {
        throw new Error('缺少地点参数，请提供地点名称');
      }
      
      const result = await geocodeLocation(location);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            location: location,
            longitude: result.longitude,
            latitude: result.latitude,
            formatted_address: result.formatted_address,
            message: `地点 "${location}" 的坐标为：经度 ${result.longitude}°，纬度 ${result.latitude}°`
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error in geocode_location:', error);
      return {
        content: [{
          type: 'text',
          text: `地理编码失败: ${error instanceof Error ? error.message : '未知错误'}`
        }],
        isError: true
      };
    }
  }
);

// 注册真太阳时转换工具
server.tool(
  'convert_to_apparent_solar_time',
  '将北京时间根据经纬度转换为真太阳时',
  ApparentSolarTimeInputSchema,
  async (args) => {
    try {
      const { beijingTime, longitude, latitude } = args || {};
      
      if (!beijingTime) {
        throw new Error('缺少北京时间参数，请提供时间（格式：YYYY-MM-DD HH:mm:ss）');
      }
      
      if (longitude === undefined) {
        throw new Error('缺少经度参数，请提供经度坐标');
      }
      
      const apparentTime = calculateApparentSolarTime(beijingTime, longitude);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            beijing_time: beijingTime,
            longitude: longitude,
            latitude: latitude,
            apparent_solar_time: apparentTime,
            message: `北京时间 ${beijingTime} 在经度 ${longitude}° 处的真太阳时为：${apparentTime}`
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error in convert_to_apparent_solar_time:', error);
      return {
        content: [{
          type: 'text',
          text: `真太阳时转换失败: ${error instanceof Error ? error.message : '未知错误'}`
        }],
        isError: true
      };
    }
  }
);

// 注册排盘工具
server.tool(
  'generate_astrolabe',
  '根据用户的生日、性别等信息生成紫微斗数星盘，支持地点参数进行真太阳时转换',
  AstrolabeInputSchema,
  async (args) => {
    try {
      console.log('Raw args received:', JSON.stringify(args, null, 2));
      
      // 解构参数
      const { 
        birthday, 
        birthTime, 
        gender, 
        calendarType = 'solar', 
        isLeapMonth = false, 
        language = 'zh-CN',
        location
      } = args || {};
      
      console.log('Extracted values:', { birthday, birthTime, gender, calendarType, isLeapMonth, language });
      
      // 处理性别参数
      let finalGender = gender;
      if (finalGender === 'male') {
        finalGender = '男';
      } else if (finalGender === 'female') {
        finalGender = '女';
      }
      
      // 处理日历类型参数
      let finalCalendarType = calendarType;
      if (finalCalendarType === 'gregorian') {
        finalCalendarType = 'solar';
      } else if (finalCalendarType === '阴历' || finalCalendarType === '农历') {
        finalCalendarType = 'lunar';
      } else if (finalCalendarType === '阳历') {
        finalCalendarType = 'solar';
      }
      
      console.log('Final processed params:', { 
        birthday, 
        birthTime, 
        gender: finalGender, 
        calendarType: finalCalendarType, 
        isLeapMonth, 
        language 
      });
      
      // 验证必需参数
      if (!birthday) {
        throw new Error('缺少生日参数，请提供生日信息（格式：YYYY-MM-DD）');
      }
      
      if (birthTime === undefined) {
        throw new Error('缺少出生时辰参数，请提供出生时辰（0-12的数字，子时为0）');
      }
      
      if (!finalGender) {
        throw new Error('缺少性别参数，请提供性别（"男" 或 "女"）');
      }
      
      // 验证日期格式
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) && !/^\d{4}\/\d{2}\/\d{2}$/.test(birthday)) {
        throw new Error('生日格式不正确，应为 YYYY-MM-DD 或 YYYY/MM/DD 格式');
      }
      
      // 标准化日期格式
      let finalBirthday = birthday;
      if (finalBirthday.includes('/')) {
        finalBirthday = finalBirthday.replace(/\//g, '-');
      }
      
      // 验证时间范围
      if (typeof birthTime !== 'number' || birthTime < 0 || birthTime > 11) {
        throw new Error('出生时辰应在0-11之间，子时为0，丑时为1，以此类推');
      }
      
      // 处理地点参数和真太阳时转换
      let adjustedBirthday = finalBirthday;
      let adjustedBirthTime = birthTime;
      let geocodeInfo = null;
      let apparentTimeInfo = null;
      
      if (location) {
        try {
          // 进行地理编码
          geocodeInfo = await geocodeLocation(location);
          console.log('Geocode result:', geocodeInfo);
          
          // 构造完整的出生时间字符串进行真太阳时转换
          // 将时辰转换为具体时间（取每个时辰的中点时间）
          const hourMap = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 23]; // 早子时0点，丑时2点，寅时4点...晚子时23点
          const hour = hourMap[birthTime] || 12;
          const beijingTimeStr = `${finalBirthday} ${hour.toString().padStart(2, '0')}:00:00`;
          
          // 计算真太阳时
          const apparentTimeStr = calculateApparentSolarTime(beijingTimeStr, geocodeInfo.longitude);
          console.log('Apparent solar time:', apparentTimeStr);
          
          // 解析真太阳时，提取调整后的日期和时间
          const apparentDate = new Date(apparentTimeStr);
          const apparentHour = apparentDate.getHours();
          
          // 将真太阳时的小时转换回时辰
          const newBirthTime = getTimeSlotFromHour(apparentHour);
          
          adjustedBirthday = apparentTimeStr.split(' ')[0];
          adjustedBirthTime = newBirthTime;
          
          apparentTimeInfo = {
            original_beijing_time: beijingTimeStr,
            apparent_solar_time: apparentTimeStr,
            original_birth_time_slot: birthTime,
            adjusted_birth_time_slot: newBirthTime,
            longitude: geocodeInfo.longitude,
            latitude: geocodeInfo.latitude
          };
          
          console.log('Time adjustment:', apparentTimeInfo);
        } catch (locationError) {
          console.warn('Location processing failed, using original time:', locationError);
          // 如果地点处理失败，继续使用原始时间
        }
      }
      
      // 生成星盘
      let astrolabe;
      if (finalCalendarType === 'lunar') {
        astrolabe = astro.byLunar(adjustedBirthday, adjustedBirthTime, finalGender, isLeapMonth, true, language);
      } else {
        astrolabe = astro.bySolar(adjustedBirthday, adjustedBirthTime, finalGender, true, language);
      }

      // 构建返回结果
      const result: any = {
        astrolabe: astrolabe,
        input_parameters: {
          original_birthday: birthday,
          original_birth_time: birthTime,
          gender: finalGender,
          calendar_type: finalCalendarType,
          is_leap_month: isLeapMonth,
          language: language,
          location: location
        }
      };
      
      // 如果进行了地点处理，添加相关信息
      if (geocodeInfo && apparentTimeInfo) {
        result.location_processing = {
          geocode_info: geocodeInfo,
          apparent_time_conversion: apparentTimeInfo,
          adjusted_parameters: {
            adjusted_birthday: adjustedBirthday,
            adjusted_birth_time: adjustedBirthTime
          }
        };
      }

      // 返回JSON格式的星盘数据
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error generating astrolabe:', error);
      return {
        content: [{
          type: 'text',
          text: `生成星盘时发生错误: ${error instanceof Error ? error.message : '未知错误'}`
        }],
        isError: true
      };
    }
  }
);

// 使用stdio传输协议启动服务器
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

startServer().catch(console.error);

// 导出函数供测试使用
export { calculateApparentSolarTime, geocodeLocation, getTimeSlotFromHour };