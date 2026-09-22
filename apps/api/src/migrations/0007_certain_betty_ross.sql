-- `ON DELETE set null` is added by hand: drizzle-kit emits the REFERENCES
-- clause but drops the action on a SQLite ADD COLUMN, and the default is NO
-- ACTION — which makes revoking a token that ever wrote an audit row fail with
-- SQLITE_CONSTRAINT_FOREIGNKEY. The pg migration carries the action already.
ALTER TABLE `audit_events` ADD `actor_api_token_id` text REFERENCES api_tokens(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_kind` text;
