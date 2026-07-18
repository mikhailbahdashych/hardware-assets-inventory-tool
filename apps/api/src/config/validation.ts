import * as Joi from 'joi';

export const validationSchema = Joi.object({
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().port().default(5432),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  PORT: Joi.number().port().default(3000),
  JWT_ACCESS_SECRET: Joi.string().min(8).required(),
  JWT_REFRESH_SECRET: Joi.string().min(8).required(),
  APP_ENCRYPTION_KEY: Joi.string().min(8).required(),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL: Joi.string().default('7d'),
  COOKIE_SECURE: Joi.boolean().default(false),
  MFA_ENFORCE_ALL: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(true),
});
