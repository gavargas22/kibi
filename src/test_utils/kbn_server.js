import { resolve } from 'path';
import { defaultsDeep, set } from 'lodash';
import { header as basicAuthHeader } from './base_auth';
import { kibanaUser, kibanaServer } from '../../test/shield';
import { esTestConfig } from '../test_utils/es';
import KbnServer from '../../src/server/kbn_server';

const DEFAULTS_SETTINGS = {
  server: {
    autoListen: false,
    xsrf: {
      disableProtection: true
    }
  },
  logging: {
    quiet: true
  },
  plugins: {},
  uiSettings: {
    enabled: false
  },
  optimize: {
    enabled: false
  },
};

const DEFAULT_SETTINGS_WITH_CORE_PLUGINS = {
  plugins: {
    scanDirs: [
      resolve(__dirname, '../core_plugins'),
      resolve(__dirname, '../kibi_plugins') // kibi: load kibi plugins in order to get the saved_objects_api plugin
    ],
  },
  elasticsearch: {
    url: esTestConfig.getUrl(),
    username: kibanaServer.username,
    password: kibanaServer.password
  },
  uiSettings: {
    enabled: true
  },
};

/**
 * Creates an instance of KbnServer with default configuration
 * tailored for unit tests
 *
 * @param {Object} [settings={}] Any config overrides for this instance
 * @return {KbnServer}
 */
export function createServer(settings = {}) {
  return new KbnServer(defaultsDeep({}, settings, DEFAULTS_SETTINGS));
}

/**
 *  Creates an instance of KbnServer, including all of the core plugins,
 *  with default configuration tailored for unit tests
 *
 *  @param  {Object} [settings={}]
 *  @return {KbnServer}
 */
export function createServerWithCorePlugins(settings = {}) {
  return new KbnServer(defaultsDeep({}, settings, DEFAULT_SETTINGS_WITH_CORE_PLUGINS, DEFAULTS_SETTINGS));
}

/**
 * Creates request configuration with a basic auth header
 */
export function authOptions() {
  const { username, password } = kibanaUser;
  const authHeader = basicAuthHeader(username, password);
  return set({}, 'headers.Authorization', authHeader);
}

/**
 * Makes a request with test headers via hapi server inject()
 *
 * The given options are decorated with default testing options, so it's
 * recommended to use this function instead of using inject() directly whenever
 * possible throughout the tests.
 *
 * @param {KbnServer} kbnServer
 * @param {object}    options Any additional options or overrides for inject()
 * @param {Function}  fn The callback to pass as the second arg to inject()
 */
export function makeRequest(kbnServer, options, fn) {
  options = defaultsDeep({}, authOptions(), options);
  return kbnServer.server.inject(options, fn);
}
