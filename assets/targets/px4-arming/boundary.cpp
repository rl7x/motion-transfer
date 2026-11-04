// Hackathon boundary around PX4's unchanged arming function. It holds no arming logic:
// it passes inputs in, packs the results into one integer, and clears per-step values,
// so that linear memory holds only state that outlives a step.
#include "Arming/ArmStateMachine/ArmStateMachine.hpp"

static ArmStateMachine machine;
static vehicle_status_s status;
static actuator_armed_s armed;
static HealthAndArmingChecks checks;
static bool checks_allow, checks_ran, denial_logged;

bool HealthAndArmingChecks::update(bool) { checks_ran = true; return true; }
bool HealthAndArmingChecks::canArm(uint8_t) const { return checks_allow; }
extern "C" __attribute__((noinline)) void record_denial(const char *, const char *, const char *) { denial_logged = true; }

extern "C" __attribute__((visibility("default"))) void boot(uint32_t state)
{
	machine.forceArmState(static_cast<uint8_t>(state));
	status.armed_time = 0;
	status.latest_arming_reason = 0;
	status.latest_disarming_reason = 0;
	status.nav_state = 0;
	status.hil_state = 0;
	armed.lockdown = false;
}

extern "C" __attribute__((visibility("default"))) uint32_t step(uint32_t requested, uint32_t hil, uint32_t run_checks,
		uint32_t can_arm, uint32_t reason)
{
	status.hil_state = hil ? vehicle_status_s::HIL_STATE_ON : vehicle_status_s::HIL_STATE_OFF;
	checks_allow = can_arm != 0;
	const transition_result_t result = machine.arming_state_transition(status, static_cast<arming_state_t>(requested),
			armed, checks, run_checks != 0, nullptr, static_cast<arm_disarm_reason_t>(reason));
	const uint32_t packed = static_cast<uint32_t>(result + 1)
		| static_cast<uint32_t>(machine.getArmState()) << 2
		| static_cast<uint32_t>(armed.lockdown) << 5
		| static_cast<uint32_t>(status.armed_time != 0) << 6
		| static_cast<uint32_t>(checks_ran) << 7
		| static_cast<uint32_t>(denial_logged) << 8
		| static_cast<uint32_t>(status.latest_arming_reason) << 9
		| static_cast<uint32_t>(status.latest_disarming_reason) << 13;
	status.hil_state = vehicle_status_s::HIL_STATE_OFF;
	checks_allow = false;
	checks_ran = false;
	denial_logged = false;
	return packed;
}
