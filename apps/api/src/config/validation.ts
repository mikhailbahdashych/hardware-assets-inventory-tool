import * as Joi from 'joi';

export const validationSchema = Joi.object({
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().port().default(5432),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  PORT: Joi.number().port().default(3000),
  // 32+ chars: an HS256 secret short enough to brute-force forges admin tokens.
  // The .env.example placeholders are explicitly rejected — blind copies fail loud.
  JWT_ACCESS_SECRET: Joi.string().min(32).invalid('change-me-run-openssl-rand-hex-32').required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).invalid('change-me-run-openssl-rand-hex-32').required(),
  // Exactly 32 bytes of hex — AES-256-GCM key for MFA secrets (Phase 3).
  APP_ENCRYPTION_KEY: Joi.string().hex().length(64).invalid('0'.repeat(64)).required(),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL: Joi.string().default('7d'),
  COOKIE_SECURE: Joi.boolean().default(false),
  TRUST_PROXY: Joi.boolean().default(false),
  MFA_ENFORCE_ALL: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
