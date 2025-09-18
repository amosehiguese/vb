CREATE TABLE "ephemeral_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"wallet_address" varchar(44) NOT NULL,
	"private_key" text NOT NULL,
	"status" varchar(20) DEFAULT 'created',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ephemeral_wallets_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "ephemeral_wallet_address" varchar(44);--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "trading_status" varchar(30) DEFAULT 'idle';