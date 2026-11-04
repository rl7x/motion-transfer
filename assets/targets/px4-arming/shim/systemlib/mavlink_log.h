#pragma once
// Stub. Records that a denial was logged. The message text is not formatted.
extern "C" void record_denial(const char *format, const char *from, const char *to);
#define mavlink_log_critical(_pub, _text, ...) record_denial(_text, __VA_ARGS__)
