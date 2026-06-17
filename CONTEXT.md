# Weapon

Weapon is a contract-driven TypeScript API toolkit. Its language distinguishes protocol-agnostic contracts from transport-specific exposure and runtime hosts.

## Language

**Operation Path**:
The internal contract identity of an operation, derived from its position in the contract tree.
_Avoid_: Command path, route

**Command Path**:
The public argv route that invokes a CLI operation.
_Avoid_: Operation path
