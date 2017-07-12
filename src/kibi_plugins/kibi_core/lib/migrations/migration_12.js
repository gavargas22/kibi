import requirefrom from 'requirefrom';
import _ from 'lodash';
import Migration from 'kibiutils/lib/migrations/migration';

/**
 * Kibi Core - Migration 12.
 *
 * Looks for:
 *
 * - the kibi:default_dashboard_title in kibi.yml
 *
 * Then:
 *
 * - put kibi:defaultDashboardTitle value to the advanced settings
 */
export default class Migration12 extends Migration {

  constructor(configuration) {
    super(configuration);

    this._logger = configuration.logger;
    this._client = configuration.client;
    this._config =  configuration.config;
    this._index = configuration.config.get('kibana.index');
    this._defaultDashboardTitleYml = configuration.config.get('kibi_core.default_dashboard_title');
    this._type = 'config';
  }

  static get description() {
    return 'Migrate kibi_core:default_dashboard_title property to advanced settings';
  }

  async count() {
    let count = 0;
    if (!this._defaultDashboardTitleYml) {
      return count;
    }
    const objects = await this.scrollSearch(this._index, this._type);
    _.each(objects, function (object) {
      const defaultDashboardSettings = object._source['kibi:defaultDashboardTitle'];

      if(!defaultDashboardSettings) {
        count++;
      }
    });
    return count;
  }

  async upgrade() {
    if (!this._defaultDashboardTitleYml) {
      return;
    }

    let body = '';
    let upgraded = 0;
    this._logger.info(`Updating kibi_core.default_dashboard_title from config`);
    const objects = await this.scrollSearch(this._index, this._type);
    for (const obj of objects) {
      if (!obj._source['kibi:defaultDashboardTitle']) {
        body += JSON.stringify({
          update: {
            _index: obj._index,
            _type: obj._type,
            _id: obj._id
          }
        }) + '\n' + JSON.stringify({
          doc: {
            'kibi:defaultDashboardTitle': this._defaultDashboardTitleYml
          }
        }) + '\n';
        upgraded++;

        if (upgraded > 0) {
          await this._client.bulk({
            refresh: true,
            body: body
          });
        }
      }
    }
    return upgraded;
  }
}
