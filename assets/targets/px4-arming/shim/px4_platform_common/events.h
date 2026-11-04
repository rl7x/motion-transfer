#pragma once
#include <stdint.h>
// Stub. Enum values are copied from PX4 v1.14.0 src/lib/events/enums.json. Sending an event does nothing.
namespace events {
enum class Log : uint8_t { Critical = 2 };
constexpr uint32_t ID(const char *) { return 0; }
namespace px4 { namespace enums {
enum class arming_state_t : uint8_t { init = 0, standby = 1, armed = 2, standby_error = 3, shutdown = 4, inair_restore = 5 };
enum class arm_disarm_reason_t : uint8_t {
	transition_to_standby = 0, rc_stick = 1, rc_switch = 2, command_internal = 3, command_external = 4,
	mission_start = 5, auto_disarm_land = 6, auto_disarm_preflight = 7, kill_switch = 8, lockdown = 9,
	failure_detector = 10, shutdown = 11, unit_test = 12, rc_button = 13, failsafe = 14,
};
}}
template <typename A, typename B> inline void send(uint32_t, Log, const char *, A, B) {}
}
