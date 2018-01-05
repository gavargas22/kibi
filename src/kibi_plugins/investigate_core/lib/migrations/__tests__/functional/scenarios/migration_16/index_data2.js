/**
 * Defines the index with no visualisations
 */
module.exports = [
  {
    index: {
      _index: '.kibi',
      _type: 'foo',
      _id: 'some-object-which-is-not-a-visualisation'
    }
  },
  {
    title : 'Scatterplot2',
    version : 1,
    visState : '{"title":"boo","type":"kibi_scatterplot_vis"}'
  }
];
