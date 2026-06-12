const { ethers } = require("hardhat");

async function main() {
    const [signer] = await ethers.getSigners();
    console.log("Account:", signer.address);
    const bal = await ethers.provider.getBalance(signer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH\n");

    const tokenAAddr = "0x56B29cebde53A3F20a337663CC954Ef2D16498EB";
    const tokenBAddr = "0xc18E9BE3DBA95923C0654e8d6637590B3b669fb2";
    const poolAAddr = "0xf5a106EF1AdEF0378358b3DCbe9E54b38AE179b6";
    const poolBAddr = "0x370FbF65D18b046A3968AD6C2dd32BcFd8bf2820";
    const arbitrageAddr = "0xC2036B0e2ab034984F4872aae00d07ef5Eab0020";

    // Get contract instances (using minimal Arbitrage ABI)
    const arbitrageArtifact = require("../artifacts/contracts/ArbitrageMinimal.sol/FlashSwapArbitrage.json");
    const arbitrage = new ethers.Contract(arbitrageAddr, arbitrageArtifact.abi, signer);
    const tokenA = await ethers.getContractAt("MyToken", tokenAAddr);
    const tokenB = await ethers.getContractAt("MyToken", tokenBAddr);

    const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
    const poolA = new ethers.Contract(poolAAddr, PoolABI, signer);
    const poolB = new ethers.Contract(poolBAddr, PoolABI, signer);

    // Show pool states before
    const [rA0_b, rA1_b] = await poolA.getReserves();
    const [rB0_b, rB1_b] = await poolB.getReserves();
    console.log("=== Before Arbitrage ===");
    console.log(`PoolA: ${ethers.formatEther(rA0_b)} TKA, ${ethers.formatEther(rA1_b)} TKB (1 TKA = ${Number(rA1_b)/Number(rA0_b)} TKB)`);
    console.log(`PoolB: ${ethers.formatEther(rB0_b)} TKA, ${ethers.formatEther(rB1_b)} TKB (1 TKA = ${Number(rB1_b)/Number(rB0_b)} TKB)`);

    // Try a moderate borrow amount
    const borrowAmount = ethers.parseEther("10");
    console.log(`\nBorrow amount: ${ethers.formatEther(borrowAmount)} TKA`);

    // Execute arbitrage
    console.log("\n=== Executing Flash Swap Arbitrage ===");
    const tx = await arbitrage.startArbitrage(poolAAddr, poolBAddr, borrowAmount);
    console.log("Tx hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("Confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    // Show pool states after
    const [rA0_a, rA1_a] = await poolA.getReserves();
    const [rB0_a, rB1_a] = await poolB.getReserves();
    console.log("\n=== After Arbitrage ===");
    console.log(`PoolA: ${ethers.formatEther(rA0_a)} TKA, ${ethers.formatEther(rA1_a)} TKB`);
    console.log(`PoolB: ${ethers.formatEther(rB0_a)} TKA, ${ethers.formatEther(rB1_a)} TKB`);

    // Pool state changes
    console.log("\n=== Pool State Changes ===");
    console.log(`PoolA TKA: ${ethers.formatEther(rA0_b)} -> ${ethers.formatEther(rA0_a)} (Δ${ethers.formatEther(rA0_a - rA0_b)})`);
    console.log(`PoolA TKB: ${ethers.formatEther(rA1_b)} -> ${ethers.formatEther(rA1_a)} (Δ${ethers.formatEther(rA1_a - rA1_b)})`);
    console.log(`PoolB TKA: ${ethers.formatEther(rB0_b)} -> ${ethers.formatEther(rB0_a)} (Δ${ethers.formatEther(rB0_a - rB0_b)})`);
    console.log(`PoolB TKB: ${ethers.formatEther(rB1_b)} -> ${ethers.formatEther(rB1_a)} (Δ${ethers.formatEther(rB1_a - rB1_b)})`);

    // K invariant check
    const kA_before = rA0_b * rA1_b;
    const kA_after = rA0_a * rA1_a;
    console.log(`\nPoolA K: ${kA_before} -> ${kA_after} (Δ+${kA_after - kA_before})`);

    // Arbitrage contract profit
    const profitA = await tokenA.balanceOf(arbitrageAddr);
    const profitB = await tokenB.balanceOf(arbitrageAddr);
    console.log("\n=== Arbitrage Contract Profit ===");
    console.log(`TKA: ${ethers.formatEther(profitA)}`);
    console.log(`TKB: ${ethers.formatEther(profitB)}`);

    // Withdraw profit
    if (profitA > 0n || profitB > 0n) {
        console.log("\nWithdrawing profit...");
        const wTx = await arbitrage.withdraw();
        await wTx.wait();
        console.log("Profit withdrawn!");
        const newBalA = await tokenA.balanceOf(signer.address);
        const newBalB = await tokenB.balanceOf(signer.address);
        console.log(`Owner TKA: ${ethers.formatEther(newBalA)}`);
        console.log(`Owner TKB: ${ethers.formatEther(newBalB)}`);
    }

    console.log("\n=== Flash Swap Arbitrage Completed Successfully! ===");
    console.log(`Arbitrage tx: ${tx.hash}`);
    console.log(`View on Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
}

main().catch(console.error);
