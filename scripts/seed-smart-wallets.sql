-- Seed Smart Wallets
-- Top 20 traders by PnL with win_rate > 67% and total_positions > 30
-- Source: traders-by-category.json
-- Run: psql $DATABASE_URL -f scripts/seed-smart-wallets.sql

-- Ensure uuid extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insert top 20 smart wallets (sorted by PnL)
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xee00ba338c59557141789b127927a55f5cc5cea1', 'S-Works [WR:67%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xa9878e59934ab507f9039bcb917c1bae0451141d', 'ilovecircle [WR:73%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xc6587b11a2209e46dfe3928b31c5514a8e33b784', 'Erasmus [WR:76%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xed107a85a4585a381e48c7f7ca4144909e7dd2e5', 'bobe2 [WR:94%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x8861f0bb5e0c19474ba73beeadc13ed8915beed6', 'yjcr [WR:88%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x53d2d3c78597a78402d4db455a680da7ef560c3f', 'abeautifulmind [WR:68%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x000d257d2dc7616feaef4ae0f14600fdf50a758e', 'scottilicious [WR:85%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xfffe4013adfe325c6e02d36dc66e091f5476f52c', 'therealbatman [WR:95%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x18ba5145fba0fd51e68972268f5773175763e68f', 'FoldingNuts272 [WR:100%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x090a0d3fc9d68d3e16db70e3460e3e4b510801b4', 'slight- [WR:73%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xf7850ebb60c10d5375fff6e596d55b69fdec05ed', 'AreWeNotEntertained [WR:95%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xd189664c5308903476f9f079820431e4fd7d06f4', 'rwo [WR:85%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x2a923d2f6edbc894e76357104e654b27a0d9071e', 'Anon_0x2a92 [WR:68%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x7177a7f5c216809c577c50c77b12aae81f81ddef', 'kcnyekchno [WR:72%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b', 'Car [WR:70%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x4344066fa99418555cd750de88883b703003caef', 'beibeidabest [WR:74%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0xbaa2bcb5439e985ce4ccf815b4700027d1b92c73', 'denizz [WR:77%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x7abe2e7eac6f63b1bf4c21eeae71b03e9bd9b47e', 'bestfriends [WR:68%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x86793ad1e8f33ae23bcaf93200ec5c7bd2664659', 'cocoandcoco [WR:71%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;
INSERT INTO smart_wallets (address, alias, is_active) VALUES ('0x6bab41a0dc40d6dd4c1a915b8c01969479fd1292', 'Dropper [WR:79%]', true) ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, is_active = true;

-- Verify
SELECT COUNT(*) as total_wallets FROM smart_wallets WHERE is_active = true;
