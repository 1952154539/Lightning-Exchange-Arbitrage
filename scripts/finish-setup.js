const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Account:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");
    console.log("Nonce:", await deployer.getNonce());

    const tokenAAddr = "0x56B29cebde53A3F20a337663CC954Ef2D16498EB";
    const tokenBAddr = "0xc18E9BE3DBA95923C0654e8d6637590B3b669fb2";
    const poolAAddr = "0xf5a106EF1AdEF0378358b3DCbe9E54b38AE179b6";
    const poolBAddr = "0x370FbF65D18b046A3968AD6C2dd32BcFd8bf2820";

    const tokenA = await ethers.getContractAt("MyToken", tokenAAddr);
    const tokenB = await ethers.getContractAt("MyToken", tokenBAddr);
    const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
    const poolA = new ethers.Contract(poolAAddr, PoolABI, deployer);
    const poolB = new ethers.Contract(poolBAddr, PoolABI, deployer);

    // Check PoolA token balances
    const poolABal0 = await tokenA.balanceOf(poolAAddr);
    const poolABal1 = await tokenB.balanceOf(poolAAddr);
    console.log(`\nPoolA token balances: ${ethers.formatEther(poolABal0)} TKA, ${ethers.formatEther(poolABal1)} TKB`);

    // Step 1: If tokens are in PoolA, mint LP tokens
    if (poolABal0 > 0n && poolABal1 > 0n) {
        console.log("\n=== Minting PoolA LP tokens ===");
        const tx = await poolA.mint(deployer.address);
        console.log("PoolA mint tx:", tx.hash);
        await tx.wait();
        console.log("PoolA mint confirmed");
    }

    // Check reserves
    const [rA0, rA1] = await poolA.getReserves();
    console.log(`PoolA reserves: ${ethers.formatEther(rA0)} TKA, ${ethers.formatEther(rA1)} TKB`);

    // Step 2: Set up PoolB (1000 TKA + 2000 TKB)
    console.log("\n=== Setting up PoolB ===");
    const amountA_PB = ethers.parseEther("1000");
    const amountB_PB = ethers.parseEther("2000");

    // Check if already approved/transferred
    const allowanceA = await tokenA.allowance(deployer.address, poolBAddr);
    const allowanceB = await tokenB.allowance(deployer.address, poolBAddr);
    console.log(`Allowance for PoolB: ${ethers.formatEther(allowanceA)} TKA, ${ethers.formatEther(allowanceB)} TKB`);

    if (allowanceA < amountA_PB) {
        const tx = await tokenA.approve(poolBAddr, amountA_PB);
        console.log("Approve TKA for PoolB:", tx.hash);
        await tx.wait();
    }
    if (allowanceB < amountB_PB) {
        const tx = await tokenB.approve(poolBAddr, amountB_PB);
        console.log("Approve TKB for PoolB:", tx.hash);
        await tx.wait();
    }

    const poolBBal0 = await tokenA.balanceOf(poolBAddr);
    const poolBBal1 = await tokenB.balanceOf(poolBAddr);
    console.log(`PoolB token balances: ${ethers.formatEther(poolBBal0)} TKA, ${ethers.formatEther(poolBBal1)} TKB`);

    if (poolBBal0 < amountA_PB) {
        const tx = await tokenA.transfer(poolBAddr, amountA_PB - poolBBal0);
        console.log("Transfer TKA to PoolB:", tx.hash);
        await tx.wait();
    }
    if (poolBBal1 < amountB_PB) {
        const tx = await tokenB.transfer(poolBAddr, amountB_PB - poolBBal1);
        console.log("Transfer TKB to PoolB:", tx.hash);
        await tx.wait();
    }

    // Mint PoolB LP
    const newPoolBBal0 = await tokenA.balanceOf(poolBAddr);
    const newPoolBBal1 = await tokenB.balanceOf(poolBAddr);
    if (newPoolBBal0 > 0n && newPoolBBal1 > 0n) {
        const [r0, r1] = await poolB.getReserves();
        if (r0 === 0n && r1 === 0n) {
            console.log("Minting PoolB LP...");
            const tx = await poolB.mint(deployer.address);
            console.log("PoolB mint tx:", tx.hash);
            await tx.wait();
        }
    }

    // Verify PoolB reserves
    const [rB0, rB1] = await poolB.getReserves();
    console.log(`PoolB reserves: ${ethers.formatEther(rB0)} TKA, ${ethers.formatEther(rB1)} TKB`);

    // Step 3: Deploy Arbitrage
    console.log("\n=== Deploying Arbitrage ===");
    const Arbitrage = await ethers.getContractFactory("FlashSwapArbitrage");
    const arbitrage = await Arbitrage.deploy(tokenAAddr, tokenBAddr);
    await arbitrage.waitForDeployment();
    const arbitrageAddr = await arbitrage.getAddress();
    console.log("Arbitrage:", arbitrageAddr);

    // Step 4: Check expected profit
    const borrowAmount = ethers.parseEther("20");
    const [tokenBReceived, repayAmount, profit, profitable] = await arbitrage.getExpectedProfit(
        poolAAddr, poolBAddr, borrowAmount
    );
    console.log(`\nExpected profit (borrow ${ethers.formatEther(borrowAmount)} TKA):`);
    console.log(`  TokenB received: ${ethers.formatEther(tokenBReceived)} TKB`);
    console.log(`  Repay:           ${ethers.formatEther(repayAmount)} TKB`);
    console.log(`  Profit:          ${ethers.formatEther(profit)} TKB`);
    console.log(`  Profitable:      ${profitable}`);

    // Save addresses
    const fs = require("fs");
    fs.writeFileSync("scripts/addresses.json", JSON.stringify({
        tokenA: tokenAAddr, tokenB: tokenBAddr,
        poolA: poolAAddr, poolB: poolBAddr,
        arbitrage: arbitrageAddr,
    }, null, 2));
    console.log("\n=== Done ===");
}

main().catch(console.error);
