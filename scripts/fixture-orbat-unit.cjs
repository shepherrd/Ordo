// Explicit test data for workflows which need an already populated tree.
// Product creation now returns an empty map; no implicit fixture root is assumed.
exports.fixtureOrbatUnit = (nodeId, name) => ({
  nodeId,
  parentNodeId: null,
  unit: {
    kind: "INLINE_UNIT",
    identity: {
      fullDesignation: name,
      shortDesignation: "",
      abbreviation: "",
      unitType: "",
      echelon: "",
      service: "",
      component: "",
      callsign: "",
      headquarters: "",
      description: "",
      notes: "",
    },
    symbol: null,
  },
  nameOverride: null,
  annotation: "",
  symbolOverride: null,
});
