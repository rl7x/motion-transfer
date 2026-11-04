/** The few numbers the site shows, taken from the full evidence record. */
export function footageSummary({ earlier: [first, second], latest, repeats: [exact, final] }) {
  const scores = sessions => sessions.flatMap(session => (session.exam ? [session.exam.passed] : [])).sort((a, b) => b - a);
  return {
    firstRun: first.detail,
    looseChecks: second.exam.fromFootage,
    exactChecks: [latest.exam.fromFootage, ...scores(exact.sessions)].sort((a, b) => b - a),
    finalChecks: scores(final.sessions),
    refused: final.sessions.filter(session => !session.exam).length,
    sessions: final.sessions.length,
    worstError: latest.tracking.all.worst,
    framesCompared: latest.tracking.all.steps,
    burstsFound: latest.bursts.found,
    burstsReal: latest.bursts.real,
    measured: {
      walkingSpeed: latest.controller.config.walkingSpeed,
      dashTicks: latest.bursts.foundFrames[0],
      dashDistance: latest.controller.config.dashDistance,
      repeatGap: latest.heldOut.recharge.expected,
      firstDash: latest.heldOut.start.expected,
    },
    realDashTicks: latest.bursts.realFrames[0],
  };
}
