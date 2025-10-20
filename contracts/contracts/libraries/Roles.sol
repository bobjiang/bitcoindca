// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Roles {
    bytes32 internal constant DEFAULT_ADMIN = 0x0000000000000000000000000000000000000000000000000000000000000000;
    bytes32 internal constant PAUSER = 0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a;
    bytes32 internal constant MINTER = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6;
    bytes32 internal constant BURNER = 0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848;
    bytes32 internal constant METADATA = 0x8d4c60219e77b5304e8c9c5e6f59a1b0b9e52e0efc5df13b6b13b2d0d40c2b73;
    bytes32 internal constant EXECUTOR = 0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63;
    bytes32 internal constant KEEPER = 0xfc8737ab85eb45125971625a9ebdb75cc78e01d5c1fa80c4c6e5203f47bc4fab;
    bytes32 internal constant ROUTER_ADMIN = 0x7b765e0e932d348852a6f810bfa1ab891e259123f02db8cdcde614c570223357;
    bytes32 internal constant ORACLE_ADMIN = 0x1c6f93456f7ffe41e73aa3c9ee1c6f93456f7ffe41e73aa3c9ee1c6f93456f7f;
    bytes32 internal constant TREASURER = 0x3496274819c84aa50c5e4e2b65d6c09d2b69f20e2c3c5d0c3c5c5c5c5c5c5c5c;
    bytes32 internal constant EMERGENCY = 0x02016836a56b71f0d02689e69e326f4f4c1b9057164ef592671cf0d37c8040c0;
    bytes32 internal constant FEE_COLLECTOR = 0x8227712ef8ad39d0f26f06731ef0df8665eb7ada7f41b1ee089c29e7b6e858c0;
}
