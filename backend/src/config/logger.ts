import winston from 'winston';
import { env, isDevelopment } from './environment';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const customFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`;
  }
  
  return log;
});

const transports: winston.transport[] = [
  new winston.transports.File({ 
    filename: path.join(logsDir, 'error.log'), 
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  new winston.transports.File({ 
    filename: path.join(logsDir, 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];

if (isDevelopment) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.colorize(),
        customFormat
      )
    })
  );
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
  ]
});

export default logger;