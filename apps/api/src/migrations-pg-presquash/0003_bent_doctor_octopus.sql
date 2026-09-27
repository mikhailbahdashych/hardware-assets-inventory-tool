ALTER TABLE "audit_events" ADD COLUMN "actor_api_token_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_kind" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_api_token_id_api_tokens_id_fk" FOREIGN KEY ("actor_api_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;