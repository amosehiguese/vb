CREATE TABLE "bot_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp DEFAULT now(),
	"total_sessions" integer DEFAULT 0,
	"active_sessions" integer DEFAULT 0,
	"total_volume" numeric(18, 2) DEFAULT '0',
	"total_revenue" numeric(18, 9) DEFAULT '0',
	"total_trades" integer DEFAULT 0,
	"successful_trades" integer DEFAULT 0,
	"failed_trades" integer DEFAULT 0,
	"average_trade_size" numeric(18, 9) DEFAULT '0',
	"unique_tokens_traded" integer DEFAULT 0,
	"privileged_wallets_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_address" varchar(44) NOT NULL,
	"symbol" varchar(20),
	"name" varchar(255),
	"decimals" integer,
	"supply" varchar(50),
	"verified" boolean DEFAULT false,
	"metadata" jsonb,
	"pool_data" jsonb,
	"best_pool_address" varchar(44),
	"primary_dex" varchar(50),
	"liquidity_usd" numeric(18, 2),
	"last_validated" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tokens_contract_address_unique" UNIQUE("contract_address")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"ephemeral_wallet_address" varchar(44),
	"signature" varchar(88) NOT NULL,
	"type" varchar(10) NOT NULL,
	"token_amount" numeric(18, 9),
	"sol_amount" numeric(18, 9),
	"price" numeric(18, 9),
	"slippage" numeric(5, 2),
	"dex_used" varchar(50),
	"pool_address" varchar(44),
	"status" varchar(20) DEFAULT 'pending',
	"error_message" text,
	"block_time" timestamp,
	"slot" integer,
	"confirmations" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"wallet_address" varchar(44) NOT NULL,
	"private_key" text NOT NULL,
	"contract_address" varchar(44) NOT NULL,
	"funding_tier" varchar(20) DEFAULT 'standard',
	"token_symbol" varchar(20),
	"funding_amount" numeric(18, 9),
	"last_trade_type" varchar(10) DEFAULT 'sell',
	"current_balance" numeric(18, 9),
	"initial_balance" numeric(18, 9),
	"initial_funded_amount" numeric(18, 9),
	"revenue_transferred" numeric(18, 9),
	"revenue_signature" varchar(88),
	"total_traded" numeric(18, 9) DEFAULT '0',
	"trades_count" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'created',
	"trading_status" varchar(30) DEFAULT 'idle',
	"is_privileged" boolean DEFAULT false,
	"auto_trading_active" boolean DEFAULT false,
	"target_depletion" numeric(5, 2) DEFAULT '75',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"funded_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "user_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(44) NOT NULL,
	"session_id" varchar(255),
	"sol_balance" numeric(18, 9) DEFAULT '0',
	"token_balance" numeric(18, 9) DEFAULT '0',
	"token_mint_address" varchar(44),
	"last_updated" timestamp DEFAULT now(),
	CONSTRAINT "wallet_balances_wallet_address_unique" UNIQUE("wallet_address")
);
