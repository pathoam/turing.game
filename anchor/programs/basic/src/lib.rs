#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("1gofU3bezQhP9anagsc3HaRw1few2qZbUNMmF4kLPkh");

#[program]
pub mod turing {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.bump = bump;
        game.authority = ctx.accounts.authority.key();
    
        // Initialize the game's user account
        let game_user_account = &mut ctx.accounts.game_user_account;
        game_user_account.user = ctx.accounts.game.key();
        game_user_account.balance = 0;
    
        Ok(())
    }
    
    pub fn create_user_account(ctx: Context<CreateUserAccount>) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.user = ctx.accounts.user.key();
        user_account.balance = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.game_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let user_account = &mut ctx.accounts.user_account;
        user_account.balance = user_account.balance.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        require!(user_account.balance >= amount, CustomError::InsufficientFunds);

        let cpi_accounts = Transfer {
            from: ctx.accounts.game_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.game.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let seeds = &[b"game".as_ref(), &[ctx.accounts.game.bump]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        user_account.balance = user_account.balance.checked_sub(amount).unwrap();
        Ok(())
    }

    pub fn attest_outcome(ctx: Context<AttestOutcome>, stake: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        let game_user_account = &mut ctx.accounts.game_user_account;
        
        let game_fee = stake / 10; // 10% fee to the game
        let net_stake = stake - game_fee;
    
        if let Some(winner_account) = &mut ctx.accounts.winner_account {
            winner_account.balance = winner_account.balance.checked_add(net_stake)
                .ok_or(error!(CustomError::ArithmeticError))?;
        }
    
        if let Some(loser_account) = &mut ctx.accounts.loser_account {
            require!(loser_account.balance >= stake, CustomError::InsufficientFunds);
            loser_account.balance = loser_account.balance.checked_sub(stake)
                .ok_or(error!(CustomError::ArithmeticError))?;
        }
    
        game_user_account.balance = game_user_account.balance.checked_add(game_fee)
            .ok_or(error!(CustomError::ArithmeticError))?;
    
        Ok(())
    }

    pub fn admin_deposit(ctx: Context<AdminDeposit>, amount: u64) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_token_account.to_account_info(),
            to: ctx.accounts.game_token_account.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let game_user_account = &mut ctx.accounts.game_user_account;
        game_user_account.balance = game_user_account.balance.checked_add(amount).unwrap();
        Ok(())
    }

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        let game_user_account = &mut ctx.accounts.game_user_account;
        require!(game_user_account.balance >= amount, CustomError::InsufficientFunds);

        let cpi_accounts = Transfer {
            from: ctx.accounts.game_token_account.to_account_info(),
            to: ctx.accounts.admin_token_account.to_account_info(),
            authority: ctx.accounts.game.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let seeds = &[b"game".as_ref(), &[ctx.accounts.game.bump]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        game_user_account.balance = game_user_account.balance.checked_sub(amount).unwrap();
        Ok(())
    }


#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 8 + 32, seeds = [b"game"], bump)]
    pub game: Account<'info, Game>,
    #[account(init, payer = authority, space = 8 + 32 + 8)]
    pub game_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateUserAccount<'info> {
    #[account(init, payer = user, space = 8 + 32 + 8)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub game_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub game_token_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}


#[derive(Accounts)]
pub struct AttestOutcome<'info> {
    #[account(mut, seeds = [b"game"], bump = game.bump)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub game_user_account: Account<'info, UserAccount>,
    // Changed from Vec to individual accounts for winner and loser
    #[account(mut)]
    pub winner_account: Option<Account<'info, UserAccount>>,
    #[account(mut)]
    pub loser_account: Option<Account<'info, UserAccount>>,
    #[account(constraint = authority.key() == game.authority @ CustomError::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminDeposit<'info> {
    #[account(mut)]
    pub game_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub game_token_account: Account<'info, TokenAccount>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,
    #[account(mut)]
    pub game_user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub game_token_account: Account<'info, TokenAccount>,
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Game {
    pub bump: u8,
    pub authority: Pubkey,
}

#[account]
pub struct UserAccount {
    pub user: Pubkey,
    pub balance: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Insufficient funds for withdrawal")]
    InsufficientFunds,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Arithmetic error")]
    ArithmeticError,
}
}