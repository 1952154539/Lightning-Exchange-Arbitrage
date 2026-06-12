const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    // Load deployed addresses
    const addresses = JSON.parse(fs.readFileSync("scripts/addresses.json", "utf8"));
    console.log("Loaded addresses from scripts/addresses.json");

    const [signer] = await ethers.getSigners();
    console.log("Executing arbitrage with account:", signer.address);

    // Get contract instances
    const arbitrage = await ethers.getContractAt("FlashSwapArbitrage", addresses.arbitrage);
    const tokenA = await ethers.getContractAt("MyToken", addresses.tokenA);
    const tokenB = await ethers.getContractAt("MyToken", addresses.tokenB);

    const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
    const poolA = new ethers.Contract(addresses.poolA, PoolABI, signer);
    const poolB = new ethers.Contract(addresses.poolB, PoolABI, signer);

    // Show current pool states
    const [resA0, resA1] = await poolA.getReserves();
    const [resB0, resB1] = await poolB.getReserves();
    console.log("\n=== Pool States Before Arbitrage ===");
    console.log(`PoolA: ${ethers.formatEther(resA0)} TKA, ${ethers.formatEther(resA1)} TKB`);
    console.log(`PoolB: ${ethers.formatEther(resB0)} TKA, ${ethers.formatEther(resB1)} TKB`);

    // Try different borrow amounts to find the most profitable
    const borrowAmounts = [
        ethers.parseEther("10"),
        ethers.parseEther("50"),
        ethers.parseEther("100"),
    ];

    let bestBorrowAmount = borrowAmounts[0];
    let bestProfit = 0n;

    console.log("\n=== Profitability Analysis ===");
    for (const amount of borrowAmounts) {
        const [, , profit, profitable] = await arbitrage.getExpectedProfit(
            addresses.poolA,
            addresses.poolB,
            amount
        );
        console.log(
            `Borrow ${ethers.formatEther(amount)} TKA: profit = ${ethers.formatEther(profit)} TKB, profitable = ${profitable}`
        );
        if (profitable && profit > bestProfit) {
            bestProfit = profit;
            bestBorrowAmount = amount;
        }
    }

    if (bestProfit === 0n) {
        console.log("\nNo profitable arbitrage opportunity found. Exiting.");
        return;
    }

    console.log(`\n=== Executing Arbitrage ===`);
    console.log(`Borrow ${ethers.formatEther(bestBorrowAmount)} TKA from PoolA`);

    // Send some ETH to the arbitrage contract for gas (if needed)
    // Actually the contract doesn't need ETH, the signer pays gas

    // Execute the arbitrage
    const tx = await arbitrage.startArbitrage(
        addresses.poolA,
        addresses.poolB,
        bestBorrowAmount,
        { gasLimit: 500000 }
    );
    console.log("Transaction sent:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Parse ArbitrageExecuted event
    const iface = arbitrage.interface;
    for (const log of receipt.logs) {
        try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed && parsed.name === "ArbitrageExecuted") {
                console.log("\n=== Arbitrage Result ===");
                console.log(`PoolA:            ${parsed.args.poolA}`);
                console.log(`PoolB:            ${parsed.args.poolB}`);
                console.log(`Borrow Amount:    ${ethers.formatEther(parsed.args.borrowAmount)} TKA`);
                console.log(`TokenB Received:  ${ethers.formatEther(parsed.args.tokenBReceived)} TKB`);
                console.log(`Repay Amount:     ${ethers.formatEther(parsed.args.repayAmount)} TKB`);
                console.log(`Profit:           ${ethers.formatEther(parsed.args.profit)} TKB`);
            }
        } catch (e) {
            // Log not from our contract
        }
    }

    // Show pool states after arbitrage
    const [resA0After, resA1After] = await poolA.getReserves();
    const [resB0After, resB1After] = await poolB.getReserves();
    console.log("\n=== Pool States After Arbitrage ===");
    console.log(`PoolA: ${ethers.formatEther(resA0After)} TKA, ${ethers.formatEther(resA1After)} TKB`);
    console.log(`PoolB: ${ethers.formatEther(resB0After)} TKA, ${ethers.formatEther(resB1After)} TKB`);

    // Check arbitrage contract balance (profit)
    const profitA = await tokenA.balanceOf(addresses.arbitrage);
    const profitB = await tokenB.balanceOf(addresses.arbitrage);
    console.log("\n=== Arbitrage Contract Balance ===");
    console.log(`TKA: ${ethers.formatEther(profitA)}`);
    console.log(`TKB: ${ethers.formatEther(profitB)}`);

    // Withdraw profit
    if (profitA > 0n || profitB > 0n) {
        console.log("\nWithdrawing profit...");
        const withdrawTx = await arbitrage.withdrawProfit();
        await withdrawTx.wait();
        console.log("Profit withdrawn to owner!");

        const ownerBalanceA = await tokenA.balanceOf(signer.address);
        const ownerBalanceB = await tokenB.balanceOf(signer.address);
        console.log(`Owner TKA balance: ${ethers.formatEther(ownerBalanceA)}`);
        console.log(`Owner TKB balance: ${ethers.formatEther(ownerBalanceB)}`);
    }

    console.log("\n=== Flash Swap Arbitrage Complete ===");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
