#pragma once
#include <stdint.h>
// Stub. Time is one fixed value so that every reachable state stays finite.
inline uint64_t hrt_absolute_time() { return 1000000; }
