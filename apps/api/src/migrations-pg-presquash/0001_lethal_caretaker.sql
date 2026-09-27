CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"dedupe_key" text,
	"created_at" text NOT NULL,
	"read_at" text
);
--> statement-breakpoint
DROP TABLE "notification_log" CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_member_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("member_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "org_settings" DROP COLUMN "email_invites";--> statement-breakpoint
ALTER TABLE "org_settings" DROP COLUMN "email_weekly_digest";