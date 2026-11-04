#pragma once
#include <stdint.h>
// Stub. The real class runs PX4's preflight checks. Here their result is an input to each step.
class HealthAndArmingChecks {
public:
	bool update(bool force_reporting = false);
	bool canArm(uint8_t nav_state) const;
};
