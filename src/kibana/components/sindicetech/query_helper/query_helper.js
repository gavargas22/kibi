define(function (require) {

  var _ = require('lodash');

  return function QueryHelperFactory(savedVisualizations, Private, Promise, timefilter, indexPatterns) {

    var kibiTimeHelper   = Private(require('components/kibi/kibi_time_helper/kibi_time_helper'));

    function QueryHelper() {
    }

    /**
     * GetVisualisations returns visualisations that are used by the list of queries
     */
    QueryHelper.prototype.getVisualisations = function (queryIds) {
      if (!queryIds) {
        return Promise.reject(new Error('Empty argument'));
      }
      return savedVisualizations.find('').then(function (resp) {
        var selectedQueries = [];

        var queryIds2 = _.map(queryIds, function (id) {
          return '"queryId":"' + id + '"';
        });
        var vis = _.filter(resp.hits, function (hit) {
          var list = _.filter(queryIds2, function (id, index) {
            if (hit.visState.indexOf(id) !== -1) {
              selectedQueries.push(queryIds[index]);
              return true;
            }
            return false;
          });
          return !!list.length;
        });
        return [ _(selectedQueries).compact().unique().value(), vis ];
      });
    };

    // constructs an or filter
    // http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/query-dsl-or-filter.html
    QueryHelper.prototype.constructOrFilter = function (esFieldName, ids, meta) {
      if (!ids || (ids.length === 0)) {
        return false;
      }
      if (!esFieldName) {
        return false;
      }
      if (!meta.value) {
        return false;
      }

      var orFilter = {
        or: [],
        meta: {}
      };
      // add extra metadata to the filter
      if (meta) {
        _.assign(orFilter.meta, meta);
      }

      _.each(ids, function (id) {
        var clause = {
          term: {}
        };
        clause.term[esFieldName] = id;
        orFilter.or.push(clause);
      });
      return orFilter;
    };

    /**
     * GetLabels returns the set of indices which are connected to the focused index,
     * i.e., the connected component of the graph.
     */
    var _getLabelsInConnectedComponent = QueryHelper.prototype.getLabelsInConnectedComponent = function (focus, relations) {
      var labels = [];

      // the set of current nodes to visit
      var current = [ focus ];
      // the set of nodes to visit in the next iteration
      var toVisit = [];
      // the set of visited nodes
      var visited = [];


      do {

        // for each relation:
        // - if some node is in the current ones, then add the adjacent
        // node to toVisit if it was not visited already
        for (var i = 0; i < relations.length; i++) {
          var relation = relations[i];
          var ind = -1;
          var label = '';

          if (relation[0].indices.length !== 1 || relation[1].indices.length !== 1) {
            throw new Error('Expected indices of size 1, but got: ' + JSON.stringify(relation, null, ' '));
          }
          if ((ind = current.indexOf(relation[0].indices[0])) !== -1) {
            label = relation[1].indices[0];
          } else if ((ind = current.indexOf(relation[1].indices[0])) !== -1) {
            label = relation[0].indices[0];
          }

          if (!!label && label !== current[ind] && visited.indexOf(label) === -1) {
            toVisit.push(label);
          }
        }

        // update the visisted set
        for (var j = current.length - 1; j >= 0; j--) {
          labels.push(current[j]);
          visited.push(current.pop());
        }
        // update the current set
        for (var k = toVisit.length - 1; k >= 0; k--) {
          current.push(toVisit.pop());
        }

      } while (current.length !== 0);

      return labels;
    };

    /**
     * focus - is the focused index id
     *
     * relations - array of enabled relations
     *
     * filtersPerIndex should be an object
     * {
     *   indexId1: [],
     *   indexId2: [],
     *   ...
     * }
     * queriesPerIndex should be an object
     * {
     *   indexId1: [],
     *   indexId2: [],
     *   ...
     * }
     * indexDashboardsMap should be an object
     * {
     *   indexId1: [],
     *   indexId2: [],
     *   ...
     * }
     */
    QueryHelper.prototype.constructJoinFilter = function (focus, relations, filtersPerIndex, queriesPerIndex, indexToDashboardMap) {
      return new Promise(function (fulfill, reject) {
        // compute part of the label
        var labels = _getLabelsInConnectedComponent(focus, relations);
        labels.sort();

        var labelValue = labels.join(' <-> ');

        var joinFilter = {
          meta: {
            value: labelValue
          },
          join_set: {
            focus: focus,
            relations: relations,
            queries: {}
          }
        };

        // here iterate over queries and add to the filters only this one which are not for focused index
        if (queriesPerIndex) {
          _.each(queriesPerIndex, function (queries, index) {
            if (index !== focus && queries instanceof Array && queries.length > 0) {
              if (!joinFilter.join_set.queries[index]) {
                joinFilter.join_set.queries[index] = [];
              }
              _.each(queries, function (fQuery) {
                // filter out only query_string queries that are only a wildcard
                if (fQuery && (!fQuery.query_string || fQuery.query_string.query !== '*')) {
                  if (!joinFilter.join_set.queries[index]) {
                    joinFilter.join_set.queries[index] = [];
                  }
                  joinFilter.join_set.queries[index].push({ query: fQuery });
                }
              });
            }
          });
        }

        if (filtersPerIndex) {
          _.each(filtersPerIndex, function (filters, index) {
            if (index !== focus && filters instanceof Array && filters.length > 0) {
              if (!joinFilter.join_set.queries[index]) {
                joinFilter.join_set.queries[index] = [];
              }
              _.each(filters, function (fFilter) {
                // clone it first so when we remove meta the original object is not modified
                var filter = _.cloneDeep(fFilter);
                if (filter.meta && filter.meta.negate === true) {
                  delete filter.meta;
                  filter = {
                    not: filter
                  };
                } else if (filter.meta) {
                  delete filter.meta;
                }

                joinFilter.join_set.queries[index].push(filter);
              });
            }
          });
        }

        // update the timeFilter
        var promises = _.chain(labels)
        .filter(function (index) {
          return index !== focus;
        })
        .map(function (index) {
          return new Promise(function (fulfill, reject) {
            indexPatterns.get(index).then(function (indexPattern) {
              // 1 check if there is a timefilter for this index
              var timeFilter = timefilter.get(indexPattern);
              if (timeFilter) {
                if (indexToDashboardMap) {
                  var dashboardId = indexToDashboardMap[indexPattern.id];
                  // update the timeFilter and add it to filters
                  kibiTimeHelper.updateTimeFilterForDashboard(dashboardId, timeFilter).then(function (updatedTimeFilter) {
                    fulfill({
                      index: index,
                      timeFilter: updatedTimeFilter
                    });
                  });
                } else {
                  fulfill({
                    index: index,
                    timeFilter: timeFilter
                  });
                }
              } else {
                // here resolve the promise with no filter just so the number of resolved one matches
                fulfill(null);
              }
            }).catch(function (err) {
              fulfill(null);
            });
          });
        }).value();

        Promise.all(promises).then(function (data) {
          // add time filters on their respective index
          for (var i = 0; i < data.length; i++) {
            if (data[i]) {
              // here we add a time filter to correct filters
              if (!joinFilter.join_set.queries[data[i].index]) {
                joinFilter.join_set.queries[data[i].index] = [];
              }
              joinFilter.join_set.queries[data[i].index].push(data[i].timeFilter);
            }
          }

        }).finally(function () {
          fulfill(joinFilter);
        });

      });
    };

    return new QueryHelper();
  };

});
