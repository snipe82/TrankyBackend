import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'tranky-api' },
  redact: {
    paths: [
      'password',
      '*.password',
      'otp',
      '*.otp',
      '*.token_id',
      'req.headers.authorization',
    ],
    censor: '[redactado]',
  },
});
