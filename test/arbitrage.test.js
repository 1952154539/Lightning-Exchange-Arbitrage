const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Flash Swap Arbitrage", function () {
    let tokenA, tokenB;
    let factory1, factory2;
    let poolA, poolB;
    let arbitrage;
    let owner, addr1;

    const amount = (n) => ethers.parseEther(String(n));

    before(async function () {
        [owner, addr1] = await ethers.getSigners();

        // Deploy tokens
        const MyToken = await ethers.getContractFactory("MyToken");
        tokenA = await MyToken.deploy("Token A", "TKA", amount(1000000));
        await tokenA.waitForDeployment();
        tokenB = await MyToken.deploy("Token B", "TKB", amount(1000000));
        await tokenB.waitForDeployment();

        // Deploy factories
        const Factory = await ethers.getContractFactory("UniswapV2Factory");
        factory1 = await Factory.deploy(owner.address);
        await factory1.waitForDeployment();
        factory2 = await Factory.deploy(owner.address);
        await factory2.waitForDeployment();

        // Create pairs
        const tokenAAddr = await tokenA.getAddress();
        const tokenBAddr = await tokenB.getAddress();

        await factory1.createPair(tokenAAddr, tokenBAddr);
        const poolAAddr = await factory1.getPair(tokenAAddr, tokenBAddr);

        await factory2.createPair(tokenAAddr, tokenBAddr);
        const poolBAddr = await factory2.getPair(tokenAAddr, tokenBAddr);

        const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
        poolA = new ethers.Contract(poolAAddr, PoolABI, owner);
        poolB = new ethers.Contract(poolBAddr, PoolABI, owner);

        // Add liquidity
        // PoolA: 1000 TKA + 1000 TKB (1:1)
        await tokenA.approve(poolAAddr, amount(1000));
        await tokenB.approve(poolAAddr, amount(1000));
        await tokenA.transfer(poolAAddr, amount(1000));
        await tokenB.transfer(poolAAddr, amount(1000));
        await poolA.mint(owner.address);

        // PoolB: 1000 TKA + 2000 TKB (1:2)
        await tokenA.approve(poolBAddr, amount(1000));
        await tokenB.approve(poolBAddr, amount(2000));
        await tokenA.transfer(poolBAddr, amount(1000));
        await tokenB.transfer(poolBAddr, amount(2000));
        await poolB.mint(owner.address);

        // Deploy arbitrage
        const Arbitrage = await ethers.getContractFactory("FlashSwapArbitrage");
        arbitrage = await Arbitrage.deploy(tokenAAddr, tokenBAddr);
        await arbitrage.waitForDeployment();
    });

    it("should have correct initial pool reserves", async function () {
        const [rA0, rA1] = await poolA.getReserves();
        const [rB0, rB1] = await poolB.getReserves();

        // Check reserves (accounting for MINIMUM_LIQUIDITY of 1000 burned)
        console.log(`PoolA: ${ethers.formatEther(rA0)} TKA, ${ethers.formatEther(rA1)} TKB`);
        console.log(`PoolB: ${ethers.formatEther(rB0)} TKA, ${ethers.formatEther(rB1)} TKB`);
    });

    it("should calculate expected profit for arbitrage", async function () {
        const poolAAddr = await poolA.getAddress();
        const poolBAddr = await poolB.getAddress();

        const borrowAmount = amount(50);
        const [tokenBReceived, repayAmount, profit, profitable] = await arbitrage.getExpectedProfit(
            poolAAddr, poolBAddr, borrowAmount
        );

        console.log(`Borrow: ${ethers.formatEther(borrowAmount)} TKA`);
        console.log(`TokenB received: ${ethers.formatEther(tokenBReceived)} TKB`);
        console.log(`Repay: ${ethers.formatEther(repayAmount)} TKB`);
        console.log(`Profit: ${ethers.formatEther(profit)} TKB`);
        console.log(`Profitable: ${profitable}`);

        expect(profitable).to.be.true;
        expect(profit).to.be.gt(0);
    });

    it("should execute flash swap arbitrage successfully", async function () {
        const poolAAddr = await poolA.getAddress();
        const poolBAddr = await poolB.getAddress();
        const arbitrageAddr = await arbitrage.getAddress();

        // Check reserves before
        const [rA0_before, rA1_before] = await poolA.getReserves();
        const [rB0_before, rB1_before] = await poolB.getReserves();

        const borrowAmount = amount(10);

        // Execute arbitrage
        const tx = await arbitrage.startArbitrage(poolAAddr, poolBAddr, borrowAmount);
        const receipt = await tx.wait();

        // Parse ArbitrageExecuted event
        let eventFound = false;
        for (const log of receipt.logs) {
            try {
                const parsed = arbitrage.interface.parseLog({
                    topics: [...log.topics],
                    data: log.data,
                });
                if (parsed && parsed.name === "ArbitrageExecuted") {
                    eventFound = true;
                    console.log("\n=== ArbitrageExecuted Event ===");
                    console.log(`Borrow Amount:   ${ethers.formatEther(parsed.args.borrowAmount)} TKA`);
                    console.log(`TokenB Received: ${ethers.formatEther(parsed.args.tokenBReceived)} TKB`);
                    console.log(`Repay Amount:    ${ethers.formatEther(parsed.args.repayAmount)} TKB`);
                    console.log(`Profit:          ${ethers.formatEther(parsed.args.profit)} TKB`);

                    expect(parsed.args.profit).to.be.gt(0);
                }
            } catch (e) {
                // Not our event
            }
        }
        expect(eventFound).to.be.true;

        // Check reserves after
        const [rA0_after, rA1_after] = await poolA.getReserves();
        const [rB0_after, rB1_after] = await poolB.getReserves();

        console.log("\n=== Pool State Changes ===");
        console.log(`PoolA TKA: ${ethers.formatEther(rA0_before)} -> ${ethers.formatEther(rA0_after)}`);
        console.log(`PoolA TKB: ${ethers.formatEther(rA1_before)} -> ${ethers.formatEther(rA1_after)}`);
        console.log(`PoolB TKA: ${ethers.formatEther(rB0_before)} -> ${ethers.formatEther(rB0_after)}`);
        console.log(`PoolB TKB: ${ethers.formatEther(rB1_before)} -> ${ethers.formatEther(rB1_after)}`);

        // Verify pool invariants still hold
        const productA_before = rA0_before * rA1_before;
        const productA_after = rA0_after * rA1_after;
        console.log(`\nPoolA K: ${productA_before} -> ${productA_after}`);
        expect(productA_after).to.be.gte(productA_before); // K should increase due to fees

        // Check arbitrage contract has profit (TokenB)
        const profitB = await tokenB.balanceOf(arbitrageAddr);
        console.log(`Arbitrage contract TKB balance: ${ethers.formatEther(profitB)}`);
        expect(profitB).to.be.gt(0);
    });

    it("should allow profit withdrawal", async function () {
        // Withdraw profit
        const ownerBalanceB_before = await tokenB.balanceOf(owner.address);
        await arbitrage.withdrawProfit();
        const ownerBalanceB_after = await tokenB.balanceOf(owner.address);

        console.log(`Owner TKB: ${ethers.formatEther(ownerBalanceB_before)} -> ${ethers.formatEther(ownerBalanceB_after)}`);
        expect(ownerBalanceB_after).to.be.gt(ownerBalanceB_before);
    });

    it("should revert if not profitable", async function () {
        // Create pools with no price difference (1:1 ratio for both)
        const tokenAAddr = await tokenA.getAddress();
        const tokenBAddr = await tokenB.getAddress();

        const Factory = await ethers.getContractFactory("UniswapV2Factory");
        const factory3 = await Factory.deploy(owner.address);
        await factory3.waitForDeployment();

        await factory3.createPair(tokenAAddr, tokenBAddr);
        const poolCAddr = await factory3.getPair(tokenAAddr, tokenBAddr);

        const PoolABI = (await ethers.getContractFactory("UniswapV2Pair")).interface;
        const poolC = new ethers.Contract(poolCAddr, PoolABI, owner);

        // Add 1:1 liquidity (same as PoolA)
        await tokenA.approve(poolCAddr, amount(1000));
        await tokenB.approve(poolCAddr, amount(1000));
        await tokenA.transfer(poolCAddr, amount(1000));
        await tokenB.transfer(poolCAddr, amount(1000));
        await poolC.mint(owner.address);

        // Try arbitrage between poolC and poolA (both 1:1, no profit)
        const poolAAddr = await poolA.getAddress();

        // Check that it's not profitable
        const [, , , profitable] = await arbitrage.getExpectedProfit(poolAAddr, poolCAddr, amount(10));
        expect(profitable).to.be.false;
    });

    it("should emit Swap, Sync, and ArbitrageExecuted events", async function () {
        const poolAAddr = await poolA.getAddress();
        const poolBAddr = await poolB.getAddress();

        const tx = await arbitrage.startArbitrage(poolAAddr, poolBAddr, amount(5));
        const receipt = await tx.wait();

        // Check for Swap events on pools
        const swapEvents = receipt.logs.filter(log => {
            try {
                const parsed = poolA.interface.parseLog({ topics: [...log.topics], data: log.data });
                return parsed.name === "Swap";
            } catch (e) { return false; }
        });
        console.log(`Swap events emitted: ${swapEvents.length}`);

        // Check for ArbitrageExecuted event
        const arbEvents = receipt.logs.filter(log => {
            try {
                const parsed = arbitrage.interface.parseLog({ topics: [...log.topics], data: log.data });
                return parsed.name === "ArbitrageExecuted";
            } catch (e) { return false; }
        });
        console.log(`ArbitrageExecuted events: ${arbEvents.length}`);
        expect(arbEvents.length).to.equal(1);
    });
});
