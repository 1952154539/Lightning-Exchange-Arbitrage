// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface IUniswapV2Pair {
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title FlashSwapArbitrage
/// @notice Executes flash swap arbitrage between two Uniswap V2 pools
/// @dev Implements IUniswapV2Callee to receive flash swap callbacks.
///      Borrows TokenA from PoolA (cheaper), sells in PoolB (more expensive),
///      repays PoolA with TokenB, keeps the profit.
contract FlashSwapArbitrage is IUniswapV2Callee {
    address public immutable owner;
    address public immutable tokenA;
    address public immutable tokenB;

    event ArbitrageExecuted(
        address indexed poolA,
        address indexed poolB,
        uint256 borrowAmount,
        uint256 tokenBReceived,
        uint256 repayAmount,
        uint256 profit
    );

    event ProfitWithdrawn(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _tokenA, address _tokenB) {
        owner = msg.sender;
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /// @notice Start the flash swap arbitrage
    /// @param poolA The pool to borrow TokenA from (where TokenA is cheaper)
    /// @param poolB The pool to sell TokenA in (where TokenA is more expensive)
    /// @param borrowAmount Amount of TokenA to borrow via flash swap
    function startArbitrage(address poolA, address poolB, uint256 borrowAmount) external {
        require(msg.sender == owner || msg.sender == address(this), "Not authorized");
        require(borrowAmount > 0, "Zero borrow amount");

        // Borrow TokenA from poolA. We need to check whether TokenA is token0 or token1.
        // Pass (poolB, borrowAmount) as callback data.
        IUniswapV2Pair(poolA).swap(
            IUniswapV2Pair(poolA).token0() == tokenA ? borrowAmount : 0,
            IUniswapV2Pair(poolA).token1() == tokenA ? borrowAmount : 0,
            address(this),
            abi.encode(poolB, borrowAmount)
        );
    }

    /// @notice Called by the Uniswap V2 pair after sending tokens
    function uniswapV2Call(
        address /* sender */,
        uint256 /* amount0 */,
        uint256 /* amount1 */,
        bytes calldata data
    ) external override {
        // msg.sender is the pool that called us (the Pair contract).
        // `sender` is the address that initiated the swap (our contract itself).
        address poolA = msg.sender;
        (address poolB, uint256 borrowAmount) = abi.decode(data, (address, uint256));

        // Verify poolA contains our tokens
        require(
            (IUniswapV2Pair(poolA).token0() == tokenA || IUniswapV2Pair(poolA).token1() == tokenA) &&
            (IUniswapV2Pair(poolA).token0() == tokenB || IUniswapV2Pair(poolA).token1() == tokenB),
            "Invalid poolA"
        );

        // Step 1: Swap borrowed TokenA for TokenB in PoolB
        uint256 tokenBReceived = _swapTokenAForTokenB(poolB, borrowAmount);
        require(tokenBReceived > 0, "Swap in poolB failed");

        // Step 2: Calculate how much TokenB to repay to PoolA
        uint256 repayAmount = _calculateRepayAmount(poolA, borrowAmount);

        require(tokenBReceived > repayAmount, "Not profitable");

        // Step 3: Repay PoolA with TokenB
        require(IERC20(tokenB).transfer(poolA, repayAmount), "Repay failed");

        uint256 profit = tokenBReceived - repayAmount;
        emit ArbitrageExecuted(poolA, poolB, borrowAmount, tokenBReceived, repayAmount, profit);
    }

    /// @notice Swap TokenA for TokenB in the given pool (regular swap, no callback)
    function _swapTokenAForTokenB(address pair, uint256 amountIn) private returns (uint256 amountOut) {
        (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair).getReserves();
        bool tokenAIsToken0 = IUniswapV2Pair(pair).token0() == tokenA;

        if (tokenAIsToken0) {
            // Swap token0 (TokenA) -> token1 (TokenB)
            amountOut = getAmountOut(amountIn, reserve0, reserve1);
            require(IERC20(tokenA).transfer(pair, amountIn), "Transfer to pool failed");
            IUniswapV2Pair(pair).swap(0, amountOut, address(this), "");
        } else {
            // Swap token1 (TokenA) -> token0 (TokenB)
            amountOut = getAmountOut(amountIn, reserve1, reserve0);
            require(IERC20(tokenA).transfer(pair, amountIn), "Transfer to pool failed");
            IUniswapV2Pair(pair).swap(amountOut, 0, address(this), "");
        }
    }

    /// @notice Calculate repayment amount: how much TokenB to return to PoolA
    function _calculateRepayAmount(address poolA, uint256 borrowAmount) private view returns (uint256) {
        (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(poolA).getReserves();
        bool tokenAIsToken0 = IUniswapV2Pair(poolA).token0() == tokenA;

        if (tokenAIsToken0) {
            // Borrowed token0, repay with token1
            return getAmountIn(borrowAmount, reserve1, reserve0);
        } else {
            // Borrowed token1, repay with token0
            return getAmountIn(borrowAmount, reserve0, reserve1);
        }
    }

    // === Uniswap V2 Math ===

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        return numerator / denominator + 1;
    }

    /// @notice Withdraw profits to owner
    function withdrawProfit() external onlyOwner {
        uint256 balanceA = IERC20(tokenA).balanceOf(address(this));
        uint256 balanceB = IERC20(tokenB).balanceOf(address(this));
        if (balanceA > 0) {
            require(IERC20(tokenA).transfer(owner, balanceA), "Withdraw tokenA failed");
            emit ProfitWithdrawn(tokenA, balanceA);
        }
        if (balanceB > 0) {
            require(IERC20(tokenB).transfer(owner, balanceB), "Withdraw tokenB failed");
            emit ProfitWithdrawn(tokenB, balanceB);
        }
    }

    /// @notice Calculate expected profit (view function, for off-chain analysis)
    function getExpectedProfit(
        address poolA,
        address poolB,
        uint256 borrowAmount
    )
        external
        view
        returns (
            uint256 tokenBReceived,
            uint256 repayAmount,
            uint256 profit,
            bool profitable
        )
    {
        (uint112 rA0, uint112 rA1, ) = IUniswapV2Pair(poolA).getReserves();
        (uint112 rB0, uint112 rB1, ) = IUniswapV2Pair(poolB).getReserves();

        bool aTAisT0 = IUniswapV2Pair(poolA).token0() == tokenA;
        bool bTAisT0 = IUniswapV2Pair(poolB).token0() == tokenA;

        if (aTAisT0) {
            // PoolA: TokenA is token0, TokenB is token1
            repayAmount = getAmountIn(borrowAmount, rA1, rA0);
            if (bTAisT0) {
                tokenBReceived = getAmountOut(borrowAmount, rB0, rB1);
            } else {
                tokenBReceived = getAmountOut(borrowAmount, rB1, rB0);
            }
        } else {
            // PoolA: TokenA is token1, TokenB is token0
            repayAmount = getAmountIn(borrowAmount, rA0, rA1);
            if (bTAisT0) {
                tokenBReceived = getAmountOut(borrowAmount, rB0, rB1);
            } else {
                tokenBReceived = getAmountOut(borrowAmount, rB1, rB0);
            }
        }

        profit = tokenBReceived > repayAmount ? tokenBReceived - repayAmount : 0;
        profitable = tokenBReceived > repayAmount;
    }
}
