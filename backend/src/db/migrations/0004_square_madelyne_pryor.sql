CREATE TABLE "session_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"wallet_address" varchar(44) NOT NULL,
	"private_key" text NOT NULL,
	"wallet_type" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"initial_token_amount" numeric(20, 9),
	"initial_gas_amount" numeric(18, 9),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "session_wallets_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
DROP TABLE "ephemeral_wallets" CASCADE;--> statement-breakpoint
ALTER TABLE "user_sessions" RENAME COLUMN "wallet_address" TO "main_funding_address";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "trade_wallet_address" varchar(44);--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "total_volume" numeric(20, 9) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "ephemeral_wallet_address";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "block_time";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "slot";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "confirmations";--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN "funding_amount";--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN "last_trade_type";--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN "total_traded";--> statement-breakpoint
ALTER TABLE "user_sessions" DROP COLUMN "trading_status";