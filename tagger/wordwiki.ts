import * as markup from '../utils/markup.ts';
import * as model from './model.ts';
import * as pageEditor from './render-page-editor.ts';
import * as schema from "./schema.ts";
import * as server from '../utils/http-server.ts';
import * as strings from "../utils/strings.ts";
import * as utils from "../utils/utils.ts";
import * as workspace from './workspace.ts';
import * as config from './config.ts';
import {db} from "./db.ts";
import {renderToStringViaLinkeDOM} from '../utils/markup.ts';
import {DenoHttpServer} from '../utils/deno-http-server.ts';
import {ScannedDocument, ScannedPage, Assertion} from './schema.ts';
import {dictSchemaJson} from "./entry-schema.ts";
import {evalJsExprSrc} from '../utils/jsterp.ts';
import {exists as fileExists} from "https://deno.land/std/fs/mod.ts"
import {friendlyRenderPageEditor} from './render-page-editor.ts';

export interface WordWikiConfig {
    hostname: string,
    port: number,
}

/**
 *
 */
export class WordWiki {
    config: WordWikiConfig;
    dictSchema: model.Schema;
    workspace: workspace.VersionedDb;
    entriesJSON_: any = undefined;
    routes: Record<string, any>;

    /**
     *
     */
    constructor(config: WordWikiConfig) {
        this.config = config;
        
        // --- Load schema and create an empty workspace
        this.dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
        this.workspace = new workspace.VersionedDb([this.dictSchema]);

        // --- Do initial load of dictionary
        const assertions = schema.selectAllAssertions('dict').all();
        assertions.forEach((a:Assertion)=>this.workspace.untrackedApplyAssertion(a));

        // --- Set up our routes
        this.routes = Object.assign(
            {},
            {wordwiki: this},
            pageEditor.routes(),
            schema.routes(),
            workspace.routes(),
        );        
    }

    /**
     *
     */
    applyProposedAssertions(assertions: Assertion[]) {

        // --- Verify that assertions are compatible with workspace


        // --- Verify that assertions are compatible with DB



        // --- Apply assertions do DB.



        // Somehow they also apply to workspace .....


        // --- Failure mode is panic!! reload from DB.

        // --- Invalidate cache (eventually is incremental, and part of
        //     workspace, just do cheezy thing for now) CHEEZE CHEEEZE XXX
        this.entriesJSON_ = undefined;
    }

    /**
     *
     */
    get entriesJSON() {
        return this.entriesJSON_ ??=
            new workspace.CurrentTupleQuery(this.workspace.getTableByTag('di')).toJSON();
    }

    samplePage(): any {
        return (
            ['html', {},
             ['head', {},
              ['meta', {charset:"utf-8"}],
              ['meta', {name:"viewport", content:"width=device-width, initial-scale=1"}],
              config.bootstrapCssLink],
             ['body', {},
              ['div', {}, 'CATS!']]]);
    }
    
    /**
     *
     */
    async startServer() {
        console.info('Starting wordwiki server');
        
        const contentdirs = {
            '/resources/': await findResourceDir('resources')+'/',
            '/scripts/': await findResourceDir('web-build')+'/',
            '/content/': 'content/',
            '/derived/': 'derived/'};
        await new DenoHttpServer({port: this.config.port,
                                  hostname: this.config.hostname,
                                  contentdirs},
                                 request=>this.requestHandler(request)).run();
    }

    /**
     *
     */
    // Proto request handler till we figure out how we want our urls etc to workc
    async requestHandler(request: server.Request): Promise<server.Response> {
        console.info('tagger request', request);
        const requestUrl = new URL(request.url);
        const filepath = decodeURIComponent(requestUrl.pathname);
        const searchParams: Record<string,string> = {};
        requestUrl.searchParams.forEach((value: string, key: string) => searchParams[key] = value);
        if(Object.keys(searchParams).length > 0)
            console.info('Search params are:', searchParams);

        // TEMPORARY MANUAL HANDING OF THE ONE VANITY URL WE ARE CURRENTLY SUPPORTING
        const pageRequest = /^(?<Page>\/page\/(?<Book>[a-zA-Z]+)\/(?<PageNumber>[0-9]+)[.]html)$/.exec(filepath);
        //console.info('pageRequest', pageRequest, 'for', filepath);
        if(pageRequest !== null) {
            const {Book, PageNumber} = pageRequest.groups as any
            if(typeof Book !== 'string') throw new Error('missing book');
            const book = Book;
            if(typeof PageNumber !== 'string') throw new Error('missing page number');
            const page_number = parseInt(PageNumber);

            const body = await friendlyRenderPageEditor(book, page_number);
            const html = renderToStringViaLinkeDOM(body);
            return Promise.resolve({status: 200, headers: {}, body: html});
        } else if (filepath === '/favicon.ico') {
            return Promise.resolve({status: 200, headers: {}, body: 'not found'});
        } else if (filepath === '/workspace-rpc-and-sync') {
            console.info('workspace sync request');
            const bodyParms = utils.isObjectLiteral(request.body) ? request.body as Record<string, any> : {};
            return workspace.workspaceRpcAndSync(bodyParms as workspace.WorkspaceRpcAndSyncRequest);
        } else {
            const jsExprSrc = strings.stripOptionalPrefix(filepath, '/');
            const bodyParms = utils.isObjectLiteral(request.body) ? request.body as Record<string, any> : {};
            return this.rpcHandler(jsExprSrc, searchParams, bodyParms);
        }
    }

    /**
     *
     */
    async rpcHandler(jsExprSrc: string,
                     searchParams: Record<string, any>,
                     bodyParms: Record<string, any>): Promise<any> {

        // --- Top level of root scope is active routes
        let rootScope = this.routes;

        // --- If we have URL search parameters, push them as a scope
        if(Object.keys(searchParams).length > 0)
            rootScope = Object.assign(Object.create(rootScope), searchParams);

        // --- If the query request body is a {}, then it is form parms or
        //     a json {} - push on scope.
        rootScope = Object.assign(Object.create(rootScope), bodyParms);

        console.info('about to eval', jsExprSrc, 'with root scope ',
                     utils.getAllPropertyNames(rootScope));

        let result = null;
        try {
            result = evalJsExprSrc(rootScope, jsExprSrc);
            while(result instanceof Promise)
                result = await result;
        } catch(e) {
            // TODO more fiddling here.
            console.info('request failed', e);
            return server.jsonResponse({error: String(e)}, 400)
        }

        if(typeof result === 'string')
            return server.htmlResponse(result);
        else if(markup.isElemMarkup(result) && Array.isArray(result) && result[0] === 'html') // this squigs me - but is is soooo convenient!
            return server.htmlResponse(markup.renderToStringViaLinkeDOM(result));
        else
            return server.jsonResponse(result);

        // result can be a command - like forward
        // result can be json, a served page, etc
        // so - want to define a result interface - and have the individualt mentods rethren tnat
        // this can also be the opporthunity to allow streaming
        // this mech is part of our deno server stuff.
        // have shortcuts for returning other things:

        //return Promise.resolve({status: 200, headers: {}, body: 'not found'});        
    }
}


/**
 * We want the site resources (.js, .css, images) to be part of the source tree
 * (ie. under revision control etc).  So we have a directory in the source tree
 * called 'resources'.  AFAICT Deno has no particular support for this (accessing
 * these files as part of it's normal package mechanism) - so for now we are
 * using import.meta to find this file, then locating the resource dir relative to that.
 *
 * The present issue is that we are only supporting file: urls for now.
 *
 * An additional complication to consider when improving this is that in the
 * public site, we will usually be running behind apache or nginx, so having the
 * resouces available as files in a known location is important.
 *
 * Also: once we start uploading resources to a CDN, we will want to make corresponding
 * changes to resources URLs.
 */
async function findResourceDir(resourceDirName: string = 'resources') {
    const serverFileUrl = new URL(import.meta.url);
    if(serverFileUrl.protocol !== 'file:')
        throw new Error(`wordwiki server can only be run (for now) with it's code on the local filesystem (to allow access to resource files) - got server file url - ${serverFileUrl} with protocol ${serverFileUrl.protocol}`);
    const serverFilePath = decodeURIComponent(serverFileUrl.pathname);
    const resourceDir = strings.stripRequiredSuffix(serverFilePath, '/tagger/wordwiki.ts')+'/'+resourceDirName;
    const resourceMarkerPath = resourceDir+'/'+'resource_dir_marker.txt';
    if(!await fileExists(resourceMarkerPath))
        throw new Error(`resource directory ${resourceDir} is missing marker file ${resourceMarkerPath}`);

    return resourceDir;
}


if (import.meta.main) {
    const args = Deno.args;
    const command = args[0];
    switch(command) {
        case 'serve':
            new WordWiki({hostname: 'localhost', port: 9000}).startServer();
            break;
        default:
            throw new Error(`incorrect usage: unknown command "${command}"`);
    }
}
