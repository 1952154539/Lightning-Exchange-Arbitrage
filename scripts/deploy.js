const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

    // ---- Step 1: Deploy ERC20 Tokens ----
    const MyToken = await ethers.getContractFactory("MyToken");
    const tokenA = await MyToken.deploy("Token A", "TKA", ethers.parseEther("1000000"));
    await tokenA.waitForDeployment();
    const tokenAAddr = await tokenA.getAddress();
    console.log("TokenA deployed:", tokenAAddr);

    const tokenB = await MyToken.deploy("Token B", "TKB", ethers.parseEther("1000000"));
    await tokenB.waitForDeployment();
    const tokenBAddr = await tokenB.getAddress();
    console.log("TokenB deployed:", tokenBAddr);

    // ---- Step 2: Deploy UniswapV2 Factories ----
    const Factory = await ethers.getContractFactory("UniswapV2Factory");
    const factory1 = await Factory.deploy(deployer.address);
    await factory1.waitForDeployment();
    const factory1Addr = await factory1.getAddress();
    console.log("Factory1 deployed:", factory1Addr);

    const factory2 = await Factory.deploy(deployer.address);
    await factory2.waitForDeployment();
    const factory2Addr = await factory2.getAddress();
    console.log("Factory2 deployed:", factory2Addr);

    // ---- Step 3: Create Pools ----
    let tx = await factory1.createPair(tokenAAddr, tokenBAddr);
    await tx.wait();
    const poolAAddr = await factory1.getPair(tokenAAddr, tokenBAddr);
    console.log("PoolA (Factory1):", poolAAddr);

    tx = await factory2.createPair(tokenAAddr, tokenBAddr);
    await tx.wait();
    const poolBAddr = await factory2.getPair(tokenAAddr, tokenBAddr);
    console.log("PoolB (Factory2):", poolBAddr);

    // Pool contracts
    const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
    const poolA = new ethers.Contract(poolAAddr, PoolABI, deployer);
    const poolB = new ethers.Contract(poolBAddr, PoolABI, deployer);

    // ---- Step 4: Add Liquidity with Price Difference ----
    // PoolA: 1000 TKA + 1000 TKB  =>  price of TKA = 1 TKB
    const amountA_PoolA = ethers.parseEther("1000");
    const amountB_PoolA = ethers.parseEther("1000");

    await tokenA.approve(poolAAddr, amountA_PoolA);
    await tokenB.approve(poolAAddr, amountB_PoolA);
    await tokenA.transfer(poolAAddr, amountA_PoolA);
    await tokenB.transfer(poolAAddr, amountB_PoolA);
    await poolA.mint(deployer.address);
    console.log("PoolA liquidity: 1000 TKA + 1000 TKB (1 TKA = 1 TKB)");

    // PoolB: 1000 TKA + 2000 TKB  =>  price of TKA = 2 TKB
    const amountA_PoolB = ethers.parseEther("1000");
    const amountB_PoolB = ethers.parseEther("2000");

    await tokenA.approve(poolBAddr, amountA_PoolB);
    await tokenB.approve(poolBAddr, amountB_PoolB);
    await tokenA.transfer(poolBAddr, amountA_PoolB);
    await tokenB.transfer(poolBAddr, amountB_PoolB);
    await poolB.mint(deployer.address);
    console.log("PoolB liquidity: 1000 TKA + 2000 TKB (1 TKA = 2 TKB)");

    // ---- Step 5: Verify Reserves ----
    const [resA0, resA1] = await poolA.getReserves();
    const [resB0, resB1] = await poolB.getReserves();
    console.log(`\nPoolA reserves: ${ethers.formatEther(resA0)} TKA : ${ethers.formatEther(resA1)} TKB`);
    console.log(`PoolB reserves: ${ethers.formatEther(resB0)} TKA : ${ethers.formatEther(resB1)} TKB`);

    // ---- Step 6: Deploy Arbitrage Contract ----
    const Arbitrage = await ethers.getContractFactory("FlashSwapArbitrage");
    const arbitrage = await Arbitrage.deploy(tokenAAddr, tokenBAddr);
    await arbitrage.waitForDeployment();
    const arbitrageAddr = await arbitrage.getAddress();
    console.log("\nArbitrage deployed:", arbitrageAddr);

    // ---- Step 7: Check Expected Profit ----
    const borrowAmount = ethers.parseEther("100");
    const [tokenBReceived, repayAmount, profit, profitable] = await arbitrage.getExpectedProfit(
        poolAAddr,
        poolBAddr,
        borrowAmount
    );
    console.log(`\nExpected arbitrage (borrow ${ethers.formatEther(borrowAmount)} TKA from PoolA):`);
    console.log(`  TokenB received from PoolB: ${ethers.formatEther(tokenBReceived)} TKB`);
    console.log(`  Repay amount to PoolA:      ${ethers.formatEther(repayAmount)} TKB`);
    console.log(`  Profit:                     ${ethers.formatEther(profit)} TKB`);
    console.log(`  Profitable:                 ${profitable}`);

    // ---- Summary ----
    console.log("\n========================================");
    console.log("       DEPLOYMENT SUMMARY");
    console.log("========================================");
    console.log(`TokenA:      ${tokenAAddr}`);
    console.log(`TokenB:      ${tokenBAddr}`);
    console.log(`Factory1:    ${factory1Addr}`);
    console.log(`Factory2:    ${factory2Addr}`);
    console.log(`PoolA:       ${poolAAddr}`);
    console.log(`PoolB:       ${poolBAddr}`);
    console.log(`Arbitrage:   ${arbitrageAddr}`);
    console.log("========================================");

    // Save addresses to file for the arbitrage script
    const fs = require("fs");
    const addresses = {
        tokenA: tokenAAddr,
        tokenB: tokenBAddr,
        factory1: factory1Addr,
        factory2: factory2Addr,
        poolA: poolAAddr,
        poolB: poolBAddr,
        arbitrage: arbitrageAddr,
    };
    fs.writeFileSync("scripts/addresses.json", JSON.stringify(addresses, null, 2));
    console.log("\nAddresses saved to scripts/addresses.json");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
