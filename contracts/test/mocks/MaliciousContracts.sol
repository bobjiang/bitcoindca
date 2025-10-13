// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousReentrantWithdrawer
 * @dev Attempts reentrancy on withdraw via receive() callback
 */
contract MaliciousReentrantWithdrawer {
    address public dcaManager;
    uint256 public positionId;
    address public token;
    bool public attacking;

    constructor(address _dcaManager) {
        dcaManager = _dcaManager;
    }

    function setPosition(uint256 _positionId, address _token) external {
        positionId = _positionId;
        token = _token;
    }

    function attemptReentrantWithdraw(uint256 _positionId, uint256 amount) external {
        positionId = _positionId;
        attacking = true;

        // Call withdraw, which will trigger receive() callback
        (bool success, ) = dcaManager.call(
            abi.encodeWithSignature(
                "withdraw(uint256,address,uint256,address)",
                _positionId,
                token,
                amount,
                address(this)
            )
        );

        attacking = false;
        require(success, "Initial withdraw failed");
    }

    // Receive callback - attempt reentrancy
    receive() external payable {
        if (attacking) {
            // Try to reenter withdraw
            (bool success, ) = dcaManager.call(
                abi.encodeWithSignature(
                    "withdraw(uint256,address,uint256,address)",
                    positionId,
                    token,
                    1,
                    address(this)
                )
            );

            // Should fail due to ReentrancyGuard
            require(!success, "Reentrancy not prevented!");
        }
    }
}

/**
 * @title MaliciousReentrantDepositor
 * @dev Attempts reentrancy on deposit via malicious token callback
 */
contract MaliciousReentrantDepositor {
    address public dcaManager;
    uint256 public positionId;
    address public token;
    bool public attacking;

    constructor(address _dcaManager) {
        dcaManager = _dcaManager;
    }

    function attemptReentrantDeposit(uint256 _positionId, address _token, uint256 amount) external {
        positionId = _positionId;
        token = _token;
        attacking = true;

        // This will trigger the malicious token's transferFrom callback
        (bool success, ) = dcaManager.call(
            abi.encodeWithSignature(
                "deposit(uint256,address,uint256)",
                _positionId,
                _token,
                amount
            )
        );

        attacking = false;
        require(success, "Initial deposit failed");
    }

    function triggerReentrancy() external {
        if (attacking) {
            // Try to reenter deposit
            (bool success, ) = dcaManager.call(
                abi.encodeWithSignature(
                    "deposit(uint256,address,uint256)",
                    positionId,
                    token,
                    1
                )
            );

            // Should fail due to ReentrancyGuard
            require(!success, "Reentrancy not prevented!");
        }
    }
}

/**
 * @title MaliciousReentrantExecutor
 * @dev Attempts reentrancy during execution via malicious DEX adapter
 */
contract MaliciousReentrantExecutor {
    address public executor;
    uint256 public positionId;
    bool public attacking;

    constructor(address _executor) {
        executor = _executor;
    }

    function attemptReentrantExecution(uint256 _positionId) external {
        positionId = _positionId;
        attacking = true;

        // Call execute
        (bool success, ) = executor.call(
            abi.encodeWithSignature("execute(uint256)", _positionId)
        );

        attacking = false;
        require(success, "Initial execution failed");
    }

    // Callback simulating malicious DEX swap
    function swapCallback() external {
        if (attacking) {
            // Try to reenter execute
            (bool success, ) = executor.call(
                abi.encodeWithSignature("execute(uint256)", positionId)
            );

            // Should fail due to ReentrancyGuard
            require(!success, "Reentrancy not prevented!");
        }
    }
}

/**
 * @title MaliciousCrossFunctionReentrancy
 * @dev Attempts cross-function reentrancy (execute -> withdraw)
 */
contract MaliciousCrossFunctionReentrancy {
    address public dcaManager;
    address public executor;
    uint256 public positionId;
    address public token;
    bool public attacking;

    constructor(address _dcaManager, address _executor) {
        dcaManager = _dcaManager;
        executor = _executor;
    }

    function attemptCrossReentrancy(
        uint256 _positionId,
        address _token,
        uint256 withdrawAmount
    ) external {
        positionId = _positionId;
        token = _token;
        attacking = true;

        // Start with execute
        (bool success, ) = executor.call(
            abi.encodeWithSignature("execute(uint256)", _positionId)
        );

        attacking = false;
        require(success, "Initial execution failed");
    }

    // During execution callback, try to withdraw
    function executionCallback() external {
        if (attacking) {
            // Try to withdraw during execution
            (bool success, ) = dcaManager.call(
                abi.encodeWithSignature(
                    "withdraw(uint256,address,uint256,address)",
                    positionId,
                    token,
                    1,
                    address(this)
                )
            );

            // Should fail due to ReentrancyGuard
            require(!success, "Cross-function reentrancy not prevented!");
        }
    }
}

/**
 * @title MaliciousERC777Token
 * @dev Malicious ERC777-like token that attempts reentrancy via hooks
 */
contract MaliciousERC777Token is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;

    address public attacker;
    address public dcaManager;
    uint256 public targetPositionId;
    bool public shouldAttack;

    constructor() {
        _totalSupply = 1000000 * 10**18;
        _balances[msg.sender] = _totalSupply;
    }

    function setAttackParams(
        address _attacker,
        address _dcaManager,
        uint256 _positionId
    ) external {
        attacker = _attacker;
        dcaManager = _dcaManager;
        targetPositionId = _positionId;
        shouldAttack = true;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        _transfer(from, to, amount);

        // Malicious hook - attempt reentrancy during transfer
        if (shouldAttack && msg.sender == dcaManager) {
            shouldAttack = false;

            // Try to reenter via deposit
            (bool success, ) = dcaManager.call(
                abi.encodeWithSignature(
                    "deposit(uint256,address,uint256)",
                    targetPositionId,
                    address(this),
                    1
                )
            );

            // Should fail
            require(!success, "Reentrancy via ERC777 hook not prevented!");
        }

        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "Transfer from zero address");
        require(to != address(0), "Transfer to zero address");
        require(_balances[from] >= amount, "Insufficient balance");

        _balances[from] -= amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }
}
