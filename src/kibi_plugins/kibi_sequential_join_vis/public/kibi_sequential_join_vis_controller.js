import _ from 'lodash';
import moment from 'moment';

import chrome from 'ui/chrome';
import { uiModules } from 'ui/modules';
import { IndexPatternAuthorizationError } from 'ui/errors';

import { onVisualizePage } from 'ui/kibi/utils/on_page';

import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import { KibiSequentialJoinVisHelperFactory } from 'ui/kibi/helpers/kibi_sequential_join_vis_helper';
import { RelationsHelperFactory }  from 'ui/kibi/helpers/relations_helper';
import { DelayExecutionHelperFactory } from 'ui/kibi/helpers/delay_execution_helper';
import { SearchHelper } from 'ui/kibi/helpers/search_helper';
import isJoinPruned from 'ui/kibi/helpers/is_join_pruned';

import 'ui/kibi/directives/kibi_select';
import 'ui/kibi/directives/kibi_array_param';

function controller(dashboardGroups, getAppState, kibiState, $scope, $rootScope, Private, es, createNotifier, globalState, Promise,
  kbnIndex, config, savedDashboards, timefilter, kibiMeta, ontologyClient) {
  const DelayExecutionHelper = Private(DelayExecutionHelperFactory);
  const searchHelper = new SearchHelper(kbnIndex);
  const edit = onVisualizePage();

  const notify = createNotifier({
    location: 'Siren Relational filter'
  });
  const appState = getAppState();

  const relationsHelper = Private(RelationsHelperFactory);
   // renamed variable to sirenSequentialJoinVisHelper to be able to port code from automatic buttons more easily
  const sirenSequentialJoinVisHelper = Private(KibiSequentialJoinVisHelperFactory);
  const currentDashboardId = kibiState.getCurrentDashboardId();
  $scope.currentDashboardId = currentDashboardId;
  const queryFilter = Private(FilterBarQueryFilterProvider);

  $scope.btnCountsEnabled = function () {
    return config.get('siren:enableAllRelBtnCounts');
  };

  const buttonMetaCallback = function (button, meta) {
    if (button.forbidden) {
      button.targetCount = ''; // set to empty string to hide spinner
      button.warning = 'Access to an index referred by this button is forbidden.';
      return;
    }
    if (meta.error) {
      button.targetCount = ''; // set to empty string to hide spinner
      const error = JSON.stringify(meta.error, null, ' ');
      if (error.match(/ElasticsearchSecurityException/)) {
        button.warning = 'Access to an index referred by this button is forbidden.';
        notify.error(error);
      } else if (error.match(/index_not_found_exception/)) {
        // do not notify about missing index error
        button.warning = 'Index referred by this button does not exist.';
      } else {
        button.warning = `Got an unexpected error while computing this button's count.`;
        notify.error(JSON.stringify(error, null, ' '));
      }
      return;
    }
    button.targetCount = meta.hits.total;
    button.warning = ''; // set to empty string to hide any previous warning
    if (isJoinPruned(meta)) {
      button.isPruned = true;
      button.warning = 'Notice: This is a sample of the results because join operation was pruned';
    }
  };

  const updateCounts = function (results, scope) {

    const metaDefinitions = [];
    _.each(results, result => {
      const definition = result.button;
      // only make sense if query is there and not == null
      if (definition.query) {
        delete result.button.targetCount;
        // adding unique id as required by kibiMeta
        definition.id =
          result.button.sourceDashboardId +
          result.button.targetDashboardId +
          relationsHelper.getJoinIndicesUniqueID(
            result.button.sourceIndexPatternId,
            result.button.sourceField,
            result.button.targetIndexPatternId,
            result.button.targetField,
          );

        metaDefinitions.push({
          definition: definition,
          callback: function (error, meta) {
            if (error) {
              buttonMetaCallback(result.button, { error });
            }
            if (meta) {
              buttonMetaCallback(result.button, meta);
            }

            if (scope && scope.multiSearchData) {
              const queryParts = result.button.query.split('\n');
              const stats = {
                index: result.button.targetIndexPatternId,
                type: result.button.targetIndexPatternType,
                meta: {
                  label: result.button.label
                },
                response: meta ? meta : error,
                query: JSON.parse(queryParts[1])
              };
              if (meta && isJoinPruned(meta)) {
                stats.pruned = true;
              }
              $scope.multiSearchData.add(stats);
            }
          }
        });
      }
    });
    kibiMeta.getMetaForRelationalButtons(metaDefinitions);
  };

  // Update the counts on each button of the related filter
  const _addButtonQuery = function (buttons, dashboardId, updateOnClick = false) {
    if ($scope.multiSearchData) {
      $scope.multiSearchData.clear();
    }

    // to avoid making too many unnecessary http calls to
    //
    // 1 get dashboards metadata
    // 2 fetch field_stats while getting timeBasedIndices
    //
    // lets first collect all source and target dashboard ids from all buttons
    // and all indexPattern + dashboardIds
    // and fetch all required things before computing button queries
    const dashboardIds = [dashboardId];
    const timeBasedIndicesList = [];
    _.each(buttons, button => {
      if (button.targetDashboardId && dashboardIds.indexOf(button.targetDashboardId) === -1) {
        dashboardIds.push(button.targetDashboardId);
      }

      // compute the target indexpattern + target dashboard map
      const sourceIndicesFound = _.find(timeBasedIndicesList, item => {
        return item.indexPatternId === button.sourceIndexPatternId &&
               item.dashboardIds &&
               item.dashboardIds.length === 1 &&
               item.dashboardIds[0] === dashboardId;
      });
      if (!sourceIndicesFound) {
        timeBasedIndicesList.push({
          indexPatternId: button.sourceIndexPatternId,
          dashboardIds: [ dashboardId ]
        });
      }
      const targetIndicesFound = _.find(timeBasedIndicesList, item => {
        return item.indexPatternId === button.targetIndexPatternId &&
               item.dashboardIds &&
               item.dashboardIds.length === 1 &&
               item.dashboardIds[0] === button.targetDashboardId;
      });
      if (!targetIndicesFound) {
        timeBasedIndicesList.push({
          indexPatternId: button.targetIndexPatternId,
          dashboardIds: [ button.targetDashboardId ]
        });
      }
    });

    const dashboardStatesPromise = kibiState.getStates(dashboardIds);
    const timeBasedIndicesListPromise = kibiState.timeBasedIndicesMap(timeBasedIndicesList);

    return Promise.all([ dashboardStatesPromise, timeBasedIndicesListPromise ])
    .then(res => {
      const dashboardStates = res[0];
      const timeBasedIndicesOutputList = res[1];

      return Promise.all(_.map(buttons, (button) => {

        const sourceIndicesItem = _.find(timeBasedIndicesOutputList, item => {
          return item.indexPatternId === button.sourceIndexPatternId &&
          item.dashboardIds[0] === dashboardId;
        });
        const sourceIndices = sourceIndicesItem.timeBasedIndices;

        const targetIndicesItem = _.find(timeBasedIndicesOutputList, item => {
          return item.indexPatternId === button.targetIndexPatternId &&
          item.dashboardIds[0] === button.targetDashboardId;
        });
        const targetIndices = targetIndicesItem.timeBasedIndices;

        return sirenSequentialJoinVisHelper.getJoinSequenceFilter(
          dashboardStates[dashboardId],
          sourceIndices,
          targetIndices,
          button
        )
        .then(joinSeqFilter => {
          button.joinSeqFilter = joinSeqFilter;
          button.disabled = false;
          if ($scope.btnCountsEnabled() || updateOnClick) {
            const query = sirenSequentialJoinVisHelper.buildCountQuery(dashboardStates[button.targetDashboardId], joinSeqFilter);
            button.query = searchHelper.optimize(targetIndices, query, button.targetIndexPatternId);
            button.showSpinner = true;
          } else {
            button.query = null; //set to null to indicate that counts should not be fetched
            button.showSpinner = false;
          }
          return { button, targetIndices };
        })
        .catch((error) => {
          // If computing the indices failed because of an authorization error
          // set indices to an empty array and mark the button as forbidden.
          if (error instanceof IndexPatternAuthorizationError) {
            button.forbidden = true;
            button.disabled = true;
          }
          if ($scope.btnCountsEnabled() || updateOnClick) {
            const query = sirenSequentialJoinVisHelper.buildCountQuery(dashboardStates[button.targetDashboardId]);
            button.query = searchHelper.optimize([], query, button.targetIndexPatternId);
          }
          return { button, indices: [] };
        });
      }));

    }).catch(notify.error);
  };

  $scope.getCurrentDashboardBtnCounts = function () {
    _addButtonQuery($scope.buttons, currentDashboardId, true) // TODO take care about this true parameter
    .then(results => {
      updateCounts(results, $scope);
    });
  };

  const delayExecutionHelper = new DelayExecutionHelper(
    (data, alreadyCollectedData) => {
      alreadyCollectedData.dashboardId = data.dashboardId;
      alreadyCollectedData.buttons = data.buttons;
    },
    (data) => {
      _addButtonQuery(data.buttons, data.dashboardId)
      .then(results => {
        updateCounts(results, $scope);
      });
    },
    750,
    DelayExecutionHelper.DELAY_STRATEGY.RESET_COUNTER_ON_NEW_EVENT
  );

  const _collectUpdateCountsRequest = function (buttons, dashboardId) {
    if (edit || !buttons || !buttons.length) {
      return Promise.resolve([]);
    }
    delayExecutionHelper.addEventData({
      buttons: buttons,
      dashboardId: dashboardId
    });
    return Promise.resolve(buttons);
  };

  const _constructButtons = $scope._constructButtons = function () {
    return ontologyClient.getRelations().then((relations) => {
      const originalButtonDefs = _.filter($scope.vis.params.buttons,
        btn => relationsHelper.validateRelationIdWithRelations(btn.indexRelationId, relations));

      $scope.vis.error = '';

      if (originalButtonDefs.length !== $scope.vis.params.buttons.length) {
        $scope.vis.error = 'Invalid configuration of the Siren Investigate relational filter visualization';
        if (!edit) {
          return Promise.reject($scope.vis.error);
        }
      }

      if (!edit) {
        let getButtonDefs;
        const kacConfiguration = chrome.getInjected('kacConfiguration');
        if (kacConfiguration && kacConfiguration.acl && kacConfiguration.acl.enabled === true) {
          getButtonDefs = savedDashboards.find().then((dashboards) => {
            // iterate over the original definitions and remove the ones that depend on missing dashboards
            return _.filter(originalButtonDefs, (btn) => {
              // sourceDashboardId is optional
              if (btn.sourceDashboardId && !_.find(dashboards.hits, 'id', btn.sourceDashboardId)) {
                return false;
              }
              if (!_.find(dashboards.hits, 'id', btn.targetDashboardId)) {
                return false;
              }
              return true;
            });
          });
        } else {
          getButtonDefs = Promise.resolve(originalButtonDefs);
        }

        return getButtonDefs.then((buttonDefs) => {
          const dashboardIds = [ currentDashboardId ];
          _.each(buttonDefs, function (button) {
            if (!_.contains(dashboardIds, button.targetDashboardId)) {
              dashboardIds.push(button.targetDashboardId);
            }
          });

          return kibiState._getDashboardAndSavedSearchMetas(dashboardIds, false)
          .then((metas) => {
            return {
              metas,
              buttonDefs
            };
          });
        })
        .then(({ metas, buttonDefs }) => {
          let currentDashboardIndex;
          const dashboardIdIndexPair = new Map();

          for (let i = 0; i < metas.length; i++) {
            dashboardIdIndexPair.set(metas[i].savedDash.id, metas[i].savedSearchMeta.index);
            if (metas[i].savedDash.id === currentDashboardId) {
              currentDashboardIndex = metas[i].savedSearchMeta.index;
            }
          }

          if (!currentDashboardIndex) {
            return [];
          }

          const buttons = sirenSequentialJoinVisHelper.constructButtonsArray(
            buttonDefs,
            relations,
            currentDashboardIndex,
            currentDashboardId,
            dashboardIdIndexPair
          );

          // disable buttons until buttons are ready
          _.each(buttons, function (button) {
            button.disabled = true;
          });

          // retain the buttons order
          for (let i = 0; i < buttons.length; i++) {
            buttons[i].btnIndex = i;
          }
          if (!buttons.length) {
            $scope.vis.error =
              `The relational filter visualization "${$scope.vis.title}" is not configured for this dashboard. ` +
              `No button has a source index matching the current dashboard index: ${currentDashboardIndex}.`;
          }
          return buttons;
        })
        .catch(notify.error);
      } else {
        $scope.buttons = sirenSequentialJoinVisHelper.constructButtonsArray(
          originalButtonDefs,
          relations
        );
      }
    });
  };

  /*
   * Update counts in reaction to events
   */

  const updateButtons = function (reason) {
    if (!kibiState.isSirenJoinPluginInstalled()) {
      notify.error(
        'The relational filter requires the Federate plugin. Please install it and restart Elasticsearch.'
      );
      return;
    }

    if (edit) {
      return;
    }

    if (console.debug) {
      console.debug(`Updating counts on the relational buttons because: ${reason}`);
    }
    const self = this;

    let promise;
    if (!$scope.buttons || !$scope.buttons.length) {
      promise = _constructButtons.call(self);
    } else {
      promise = Promise.resolve($scope.buttons);
    }
    promise
    .then((buttons) => _collectUpdateCountsRequest.call(self, buttons, currentDashboardId))
    .then((buttons) => {
      // http://stackoverflow.com/questions/20481327/data-is-not-getting-updated-in-the-view-after-promise-is-resolved
      // assign data to $scope.buttons once the promises are done
      $scope.buttons = new Array(buttons.length);
      const updateSourceCount = function (currentDashboardId, relationId) {
        const virtualButton = {
          id: 'virtual-button' + this.sourceIndexPatternId + this.targetIndexPatternId + this.sourceField + this.targetField,
          sourceField: this.targetField,
          sourceIndexPatternId: this.targetIndexPatternId,
          targetField: this.sourceField,
          targetIndexPatternId: this.sourceIndexPatternId,
          targetDashboardId: currentDashboardId,
          indexRelationId: relationId
        };


        return _addButtonQuery.call(self, [ virtualButton ], this.targetDashboardId)
        .then(results => {
          updateCounts(results, $scope);
          return results;
        })
        .catch(notify.error);
      };

      for (let i = 0; i < buttons.length; i++) {
        buttons[i].updateSourceCount = updateSourceCount;
        // Returns the count of documents involved in the join
        $scope.buttons[buttons[i].btnIndex] = buttons[i];
      }
    })
    .catch(notify.error);
  };

  const kibiDashboardChangedOff = $rootScope.$on('kibi:dashboard:changed', updateButtons.bind(this, 'kibi:dashboard:changed'));

  $scope.$listen(kibiState, 'save_with_changes', function (diff) {
    if (diff.indexOf(kibiState._properties.dashboards) !== -1) {
      updateButtons.call(this, 'dashboards in kibistate changes');
    }
  });

  $scope.$listen(appState, 'save_with_changes', function (diff) {
    if (diff.indexOf('query') === -1) {
      return;
    }
    updateButtons.call(this, 'AppState changes');
  });

  $scope.$listen(queryFilter, 'update', function () {
    updateButtons.call(this, 'filters change');
  });

  $scope.$listen(globalState, 'save_with_changes', function (diff) {
    const currentDashboard = kibiState.getDashboardOnView();
    if (!currentDashboard) {
      return;
    }

    if (diff.indexOf('filters') !== -1) {
      // the pinned filters changed, update counts on all selected dashboards
      updateButtons.call(this, 'GlobalState pinned filters change');
    } else if (diff.indexOf('time') !== -1) {
      updateButtons.call(this, 'GlobalState time changed');
    } else if (diff.indexOf('refreshInterval') !== -1) {
      // force the count update to refresh all tabs count
      updateButtons.call(this, 'GlobalState refreshInterval changed');
    }
  });

  // when autoupdate is on we detect the refresh here
  const removeAutorefreshHandler = $rootScope.$on('courier:searchRefresh', (event) => {
    if ((timefilter.refreshInterval.display !== 'Off')
        && (timefilter.refreshInterval.pause === false)) {
      const currentDashboard = kibiState.getDashboardOnView();
      if (!currentDashboard) {
        return;
      }

      updateButtons('courier:searchRefresh');
    }
  });

  $scope.$on('$destroy', function () {
    delayExecutionHelper.cancel();
    kibiDashboardChangedOff();
    removeAutorefreshHandler();
    kibiMeta.flushRelationalButtonsFromQueue();
  });

  $scope.hoverIn = function (button) {
    dashboardGroups.setGroupHighlight(button.targetDashboardId);
  };

  $scope.hoverOut = function () {
    dashboardGroups.resetGroupHighlight();
  };

  // init
  updateButtons('init');

  if (edit) {
    $scope.$watch('vis.params.buttons', function () {
      _constructButtons();
    }, true);
  }
}

uiModules
.get('kibana/kibi_sequential_join_vis', ['kibana'])
.controller('KibiSequentialJoinVisController', controller);
