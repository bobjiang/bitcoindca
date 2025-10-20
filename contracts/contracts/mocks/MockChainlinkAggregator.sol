// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockChainlinkAggregator
 * @notice Lightweight Chainlink aggregator mock used for deterministic testing.
 */
contract MockChainlinkAggregator {
    struct RoundData {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    uint8 private immutable _decimals;
    uint80 private _latestRoundId;
    mapping(uint80 => RoundData) private _rounds;

    event RoundDataUpdated(
        uint80 indexed roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        uint256 ts = block.timestamp;
        _updateRoundData(1, initialAnswer, ts, ts, 1);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = _latestRoundId;
        require(roundId != 0, "No data present");
        RoundData storage data = _rounds[roundId];
        return (roundId, data.answer, data.startedAt, data.updatedAt, data.answeredInRound);
    }

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        RoundData storage data = _rounds[roundId];
        require(data.updatedAt != 0, "No data for round");
        return (roundId, data.answer, data.startedAt, data.updatedAt, data.answeredInRound);
    }

    function updateRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _updateRoundData(roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function updateAnswer(int256 answer) external {
        uint80 nextRound = _latestRoundId + 1;
        uint256 ts = block.timestamp;
        _updateRoundData(nextRound, answer, ts, ts, nextRound);
    }

    function _updateRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal {
        require(roundId != 0, "Invalid round");
        require(answer >= 0, "Negative answer");
        require(updatedAt >= startedAt, "Invalid timestamps");

        _rounds[roundId] = RoundData({
            answer: answer,
            startedAt: startedAt,
            updatedAt: updatedAt,
            answeredInRound: answeredInRound
        });
        if (roundId > _latestRoundId) {
            _latestRoundId = roundId;
        }

        emit RoundDataUpdated(roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
