# Lightning Exchange Arbitrage

基于 Uniswap V2 闪电兑换（Flash Swap）的套利合约，在测试网上演示如何利用两个流动性池之间的价差进行无风险套利。

## 原理

### 闪电贷 vs 闪电兑换

| 特性 | 闪电贷 (Flash Loan) | 闪电兑换 (Flash Swap) |
|------|---------------------|---------------------|
| 平台 | Aave 等借贷协议 | Uniswap V2 |
| 费用 | 固定 0.09% | 0.3%（等同于 swap 手续费） |
| 借款资产 | 借什么还什么 | 可借 TokenA 还 TokenB |
| 步骤 | 借款→交易→套利→还款 | 直接在一个交易对完成 |

### 闪电兑换原理

Uniswap V2 的 `swap()` 函数允许用户**先接收资产，后支付**：

1. 调用 `swap(amount0Out, amount1Out, to, data)` 时，如果 `data` 非空，Pair 会先转出代币
2. 转出后立即调用接收者的 `uniswapV2Call(sender, amount0, amount1, data)` 回调
3. 回调结束后，Pair 检查恒定乘积不变式（K = x * y）是否满足（含 0.3% 手续费）
4. 验证通过才更新储备量

这种「先拿后还」的机制就是闪电兑换的核心。

### 套利策略

1. **PoolA**：TokenA 价格较低（如 1 TKA = 1 TKB）
2. **PoolB**：TokenA 价格较高（如 1 TKA = 2 TKB）
3. 从 PoolA 闪电兑换借出 TokenA
4. 在 PoolB 卖出 TokenA 获得更多 TokenB
5. 用部分 TokenB 偿还 PoolA
6. 剩余 TokenB 即为利润

整个过程在**一笔原子交易**中完成，无需本金，无风险。

## 项目结构

```
├── contracts/
│   ├── MyToken.sol                    # ERC20 代币合约
│   ├── Arbitrage.sol                  # 闪电兑换套利合约
│   └── uniswap-v2/
│       ├── UniswapV2ERC20.sol         # LP Token 基类
│       ├── UniswapV2Factory.sol       # Pair 工厂合约
│       ├── UniswapV2Pair.sol          # 交易对合约（含 swap + flash swap）
│       ├── interfaces/                # 接口定义
│       │   ├── IUniswapV2Callee.sol   # 闪电兑换回调接口
│       │   ├── IUniswapV2Factory.sol
│       │   ├── IUniswapV2Pair.sol
│       │   └── IERC20.sol
│       └── libraries/                 # 数学库
│           ├── SafeMath.sol
│           ├── Math.sol
│           └── UQ112x112.sol
├── scripts/
│   ├── deploy.js                      # 部署脚本
│   └── arbitrage.js                   # 执行套利脚本
├── test/
│   └── arbitrage.test.js              # 单元测试
├── hardhat.config.js
└── package.json
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm

### 安装

```bash
git clone https://github.com/1952154539/Lightning-Exchange-Arbitrage.git
cd Lightning-Exchange-Arbitrage
npm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```
PRIVATE_KEY=你的测试网钱包私钥
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/你的InfuraKey
ETHERSCAN_API_KEY=你的EtherscanApiKey（可选，用于验证合约）
```

> 请确保钱包中有足够的 Sepolia ETH 用于支付 Gas 费。

### 本地测试

```bash
npx hardhat test
```

测试覆盖：
- 池子储备验证
- 套利盈利计算
- 闪电兑换套利执行
- 利润提取
- 无套利机会场景
- 事件日志验证

### 测试结果示例

```
  Flash Swap Arbitrage
PoolA: 1000.0 TKA, 1000.0 TKB
PoolB: 1000.0 TKA, 2000.0 TKB
    ✔ should have correct initial pool reserves
Borrow: 50.0 TKA
TokenB received: 94.965947516311854074 TKB
Repay: 52.789948793749670063 TKB
Profit: 42.175998722562184011 TKB
Profitable: true
    ✔ should calculate expected profit for arbitrage

=== ArbitrageExecuted Event ===
Borrow Amount:   10.0 TKA
TokenB Received: 19.743160687941225977 TKB
Repay Amount:    10.131404313951956881 TKB
Profit:          9.611756373989269096 TKB

=== Pool State Changes ===
PoolA TKA: 1000.0 -> 990.0
PoolA TKB: 1000.0 -> 1010.131404313951956881
PoolB TKA: 1000.0 -> 1010.0
PoolB TKB: 2000.0 -> 1980.256839312058774023

PoolA K: increased (fee 收入)
Arbitrage contract TKB balance: 9.611756373989269096
    ✔ should execute flash swap arbitrage successfully
```

### 部署到 Sepolia 测试网

```bash
npm run deploy
```

脚本会依次完成：
1. 部署 TokenA 和 TokenB（各 100 万初始供应）
2. 部署两个 UniswapV2Factory
3. 创建 PoolA（1 TKA = 1 TKB）和 PoolB（1 TKA = 2 TKB）
4. 添加流动性，创造价差
5. 部署 FlashSwapArbitrage 套利合约
6. 输出预期套利收益

部署地址会保存到 `scripts/addresses.json`。

### 执行套利

```bash
npm run arbitrage
```

脚本会：
1. 加载已部署的合约地址
2. 分析最优借款金额
3. 执行闪电兑换套利
4. 输出套利结果日志（包括 `ArbitrageExecuted` 事件）
5. 提取利润到所有者钱包

## 核心合约说明

### MyToken.sol

标准 ERC20 代币，基于 OpenZeppelin。部署时铸造初始供应量。

### UniswapV2Pair.sol

Uniswap V2 交易对合约，`swap()` 函数实现了闪电兑换机制：

```solidity
function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock {
    // 1. 转出代币
    if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
    if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);
    // 2. 回调（闪电兑换核心）
    if (data.length > 0) IUniswapV2Callee(to).uniswapV2Call(msg.sender, amount0Out, amount1Out, data);
    // 3. 验证 K 不变式（含 0.3% 手续费）
    require(balance0Adjusted * balance1Adjusted >= uint(_reserve0) * _reserve1 * 1000**2);
    // 4. 更新储备量
    _update(balance0, balance1, _reserve0, _reserve1);
}
```

### FlashSwapArbitrage.sol

套利合约，实现 `IUniswapV2Callee` 接口：

1. **`startArbitrage(poolA, poolB, borrowAmount)`** - 发起闪电兑换
2. **`uniswapV2Call(...)`** - 接收回调，执行套利逻辑：
   - 在 PoolB 卖出借来的 TokenA，获得 TokenB
   - 计算需要偿还 PoolA 的 TokenB 数量
   - 偿还 PoolA
   - 利润留在合约中
3. **`withdrawProfit()`** - 提取套利利润
4. **`getExpectedProfit()`** - 链上查询预期收益

### 套利数学

Uniswap V2 恒定乘积公式（含 0.3% 手续费）：

**getAmountOut**（给定输入，计算输出）：
```
amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
```

**getAmountIn**（给定输出，计算所需输入）：
```
amountIn = (amountOut * reserveIn * 1000) / ((reserveOut - amountOut) * 997) + 1
```

## 日志示例

成功执行套利后，在 Etherscan 上可以看到以下事件：

### Swap 事件（PoolA - 闪电兑换）
```
Swap(sender=Arbitrage, amount0In=0, amount1In=10131404313951956881, 
     amount0Out=10000000000000000000, amount1Out=0, to=Arbitrage)
```

### Swap 事件（PoolB - 卖出 TokenA）
```
Swap(sender=Arbitrage, amount0In=10000000000000000000, amount1In=0, 
     amount0Out=0, amount1Out=19743160687941225977, to=Arbitrage)
```

### ArbitrageExecuted 事件（套利合约）
```
ArbitrageExecuted(poolA, poolB, borrowAmount=10000000000000000000, 
                  tokenBReceived=19743160687941225977, 
                  repayAmount=10131404313951956881, 
                  profit=9611756373989269096)
```

## 技术栈

- **Solidity** 0.8.20（套利合约）+ 0.5.16（Uniswap V2 核心）
- **Hardhat** + Ethers.js v6
- **OpenZeppelin** Contracts v5
- **Sepolia** 测试网

## 参考资料

- [Uniswap V2 闪电兑换文档](https://docs.uniswap.org/contracts/v2/guides/smart-contract-integration/using-flash-swaps)
- [登链社区 - 闪电贷与闪电兑](https://learnblockchain.cn/article/2038)
- [登链社区 - 构建闪电贷套利机器人](https://learnblockchain.cn/article/2101)
- [Uniswap V2 Core](https://github.com/Uniswap/v2-core)

## 安全说明

- 本合约仅供学习研究，请勿用于主网
- 主网套利需考虑 Gas 费、MEV、滑点等因素
- 实际套利机会通常由专业做市商和机器人捕获
