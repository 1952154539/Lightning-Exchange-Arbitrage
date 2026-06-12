const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Using account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");
    console.log("Current nonce:", await deployer.getNonce());

    // Addresses from previous deployment
    const tokenAAddr = "0x56B29cebde53A3F20a337663CC954Ef2D16498EB";
    const tokenBAddr = "0xc18E9BE3DBA95923C0654e8d6637590B3b669fb2";
    const poolAAddr = "0xf5a106EF1AdEF0378358b3DCbe9E54b38AE179b6";
    const poolBAddr = "0x370FbF65D18b046A3968AD6C2dd32BcFd8bf2820";

    const tokenA = await ethers.getContractAt("MyToken", tokenAAddr);
    const tokenB = await ethers.getContractAt("MyToken", tokenBAddr);
    const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
    const poolA = new ethers.Contract(poolAAddr, PoolABI, deployer);
    const poolB = new ethers.Contract(poolBAddr, PoolABI, deployer);

    // ---- Step 1: Add liquidity to PoolA (1000 TKA + 1000 TKB, 1:1) ----
    console.log("Adding liquidity to PoolA...");
    const amountA_PA = ethers.parseEther("1000");
    const amountB_PA = ethers.parseEther("1000");

    let tx = await tokenA.approve(poolAAddr, amountA_PA, { gasPrice: 50000000000n });
    console.log("  Approve TKA for PoolA:", tx.hash);
    await tx.wait();

    tx = await tokenB.approve(poolBAddr, amountB_PA, { gasPrice: 50000000000n });
    console.log("  Approve TKB for PoolB:", tx.hash);
    await tx.wait();

    // Also approve for PoolA transfer
    tx = await tokenB.approve(poolAAddr, amountB_PA, { gasPrice: 50000000000n });
    console.log("  Approve TKB for PoolA:", tx.hash);
    await tx.wait();

    tx = await tokenA.transfer(poolAAddr, amountA_PA, { gasPrice: 50000000000n });
    console.log("  Transfer TKA to PoolA:", tx.hash);
    await tx.wait();

    tx = await tokenB.transfer(poolAAddr, amountB_PA, { gasPrice: 50000000000n });
    console.log("  Transfer TKB to PoolA:", tx.hash);
    await tx.wait();

    tx = await poolA.mint(deployer.address, { gasPrice: 50000000000n });
    console.log("  Mint PoolA LP:", tx.hash);
    await tx.wait();
    console.log("  PoolA liquidity added: 1000 TKA + 1000 TKB (1:1)");

    // ---- Step 2: Add liquidity to PoolB (1000 TKA + 2000 TKB, 1:2) ----
    console.log("\nAdding liquidity to PoolB...");
    const amountA_PB = ethers.parseEther("1000");
    const amountB_PB = ethers.parseEther("2000");

    tx = await tokenA.approve(poolBAddr, amountA_PB, { gasPrice: 50000000000n });
    console.log("  Approve TKA for PoolB:", tx.hash);
    await tx.wait();

    tx = await tokenB.approve(poolBAddr, amountB_PB, { gasPrice: 50000000000n });
    console.log("  Approve TKB for PoolB:", tx.hash);
    await tx.wait();

    tx = await tokenA.transfer(poolBAddr, amountA_PB, { gasPrice: 50000000000n });
    console.log("  Transfer TKA to PoolB:", tx.hash);
    await tx.wait();

    tx = await tokenB.transfer(poolBAddr, amountB_PB, { gasPrice: 50000000000n });
    console.log("  Transfer TKB to PoolB:", tx.hash);
    await tx.wait();

    tx = await poolB.mint(deployer.address, { gasPrice: 50000000000n });
    console.log("  Mint PoolB LP:", tx.hash);
    await tx.wait();
    console.log("  PoolB liquidity added: 1000 TKA + 2000 TKB (1:2)");

    // ---- Step 3: Verify reserves ----
    const [resA0, resA1] = await poolA.getReserves();
    const [resB0, resB1] = await poolB.getReserves();
    console.log(`\nPoolA reserves: ${ethers.formatEther(resA0)} TKA, ${ethers.formatEther(resA1)} TKB`);
    console.log(`PoolB reserves: ${ethers.formatEther(resB0)} TKA, ${ethers.formatEther(resB1)} TKB`);

    // ---- Step 4: Deploy Arbitrage ----
    console.log("\nDeploying FlashSwapArbitrage...");
    const Arbitrage = await ethers.getContractFactory("FlashSwapArbitrage");
    const arbitrage = await Arbitrage.deploy(tokenAAddr, tokenBAddr, { gasPrice: 50000000000n });
    await arbitrage.waitForDeployment();
    const arbitrageAddr = await arbitrage.getAddress();
    console.log("Arbitrage deployed:", arbitrageAddr);

    // ---- Step 5: Check expected profit ----
    const borrowAmount = ethers.parseEther("50");
    const [tokenBReceived, repayAmount, profit, profitable] = await arbitrage.getExpectedProfit(
        poolAAddr, poolBAddr, borrowAmount
    );
    console.log(`\nExpected arbitrage (borrow ${ethers.formatEther(borrowAmount)} TKA):`);
    console.log(`  TokenB received: ${ethers.formatEther(tokenBReceived)} TKB`);
    console.log(`  Repay amount:    ${ethers.formatEther(repayAmount)} TKB`);
    console.log(`  Profit:          ${ethers.formatEther(profit)} TKB`);
    console.log(`  Profitable:      ${profitable}`);

    // Save all addresses
    const fs = require("fs");
    const addresses = {
        tokenA: tokenAAddr,
        tokenB: tokenBAddr,
        factory1: "0x96DEE0dcFF657F12A95328ec5498EF90171cCdCf",
        factory2: "0x230D0da82Dd7F01aBEe5637960AE83aB8E674206",
        poolA: poolAAddr,
        poolB: poolBAddr,
        arbitrage: arbitrageAddr,
    };
    fs.writeFileSync("scripts/addresses.json", JSON.stringify(addresses, null, 2));
    console.log("\nAddresses saved to scripts/addresses.json");

    console.log("\n=== Setup Complete ===");
    console.log(`TokenA:     ${tokenAAddr}`);
    console.log(`TokenB:     ${tokenBAddr}`);
    console.log(`PoolA:      ${poolAAddr}`);
    console.log(`PoolB:      ${poolBAddr}`);
    console.log(`Arbitrage:  ${arbitrageAddr}`);
}

main().catch(console.error);
