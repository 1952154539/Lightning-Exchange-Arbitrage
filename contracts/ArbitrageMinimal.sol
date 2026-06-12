// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface IUniswapV2PairMin {
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title Minimal FlashSwapArbitrage
/// @notice Borrows TokenA from PoolA, sells in PoolB, repays PoolA with TokenB
contract FlashSwapArbitrage is IUniswapV2Callee {
    address public owner;
    address public tokenA;
    address public tokenB;

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(address a, address b) {
        owner = msg.sender;
        tokenA = a;
        tokenB = b;
    }

    function startArbitrage(address poolA, address poolB, uint256 amount) external {
        require(msg.sender == owner, "!owner");
        IUniswapV2PairMin(poolA).swap(
            IUniswapV2PairMin(poolA).token0() == tokenA ? amount : 0,
            IUniswapV2PairMin(poolA).token1() == tokenA ? amount : 0,
            address(this),
            abi.encode(poolB)
        );
    }

    function uniswapV2Call(address, uint256, uint256, bytes calldata data) external override {
        address poolA = msg.sender;
        address poolB = abi.decode(data, (address));

        // Determine borrow amount from token balance
        uint256 amount = IERC20Min(tokenA).balanceOf(address(this));
        require(amount > 0, "zero");

        bool taIsT0 = IUniswapV2PairMin(poolA).token0() == tokenA;

        // Sell TokenA for TokenB in PoolB
        uint256 out = _swapTokenAForTokenB(poolB, amount);

        // Repay PoolA
        (uint112 r0, uint112 r1,) = IUniswapV2PairMin(poolA).getReserves();
        uint256 repay = taIsT0
            ? _getAmountIn(amount, r1, r0)
            : _getAmountIn(amount, r0, r1);

        require(out > repay, "!profit");
        IERC20Min(tokenB).transfer(poolA, repay);
    }

    function _swapTokenAForTokenB(address pair, uint256 amountIn) private returns (uint256 out) {
        (uint112 r0, uint112 r1,) = IUniswapV2PairMin(pair).getReserves();
        bool taIsT0 = IUniswapV2PairMin(pair).token0() == tokenA;
        out = taIsT0
            ? _getAmountOut(amountIn, r0, r1)
            : _getAmountOut(amountIn, r1, r0);
        IERC20Min(tokenA).transfer(pair, amountIn);
        if (taIsT0) {
            IUniswapV2PairMin(pair).swap(0, out, address(this), "");
        } else {
            IUniswapV2PairMin(pair).swap(out, 0, address(this), "");
        }
    }

    function _getAmountOut(uint256 inAmt, uint256 rIn, uint256 rOut) private pure returns (uint256) {
        uint256 fee = inAmt * 997;
        return (fee * rOut) / (rIn * 1000 + fee);
    }

    function _getAmountIn(uint256 outAmt, uint256 rIn, uint256 rOut) private pure returns (uint256) {
        return (rIn * outAmt * 1000) / ((rOut - outAmt) * 997) + 1;
    }

    function withdraw() external onlyOwner {
        IERC20Min _a = IERC20Min(tokenA);
        IERC20Min _b = IERC20Min(tokenB);
        uint256 ba = _a.balanceOf(address(this));
        uint256 bb = _b.balanceOf(address(this));
        if (ba > 0) _a.transfer(owner, ba);
        if (bb > 0) _b.transfer(owner, bb);
    }

    fallback() external payable {}
    receive() external payable {}
}
