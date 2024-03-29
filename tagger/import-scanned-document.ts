import * as fs from "https://deno.land/std@0.195.0/fs/mod.ts";

import * as utils from "../utils/utils.ts";
import {unwrap} from "../utils/utils.ts";
import { db, Db, PreparedQuery, assertDmlContainsAllFields, boolnum, defaultDbPath } from "./db.ts";
import * as content from "../utils/content-store.ts";
import {exists as fileExists} from "https://deno.land/std/fs/mod.ts"
import {block} from "../utils/strings.ts";
import {ScannedDocument, ScannedDocumentOpt, selectScannedDocument, ScannedPage, ScannedPageOpt} from './schema.ts';
import * as config from "./config.ts";
import {getImageSize} from "./get-image-size.ts";

/**
 * Create a new scanned document based on the supplied fields and importing
 * the specified page files.
 */
export async function importScannedDocument(fields: ScannedDocumentOpt, pageFiles: string[]) {
    const document_id = db().insert<ScannedDocumentOpt, 'document_id'>(
        'scanned_document', fields, 'document_id');
    console.info('document_id is', document_id);
    console.info(selectScannedDocument().required({document_id}));
    for(let page_number=1; page_number<pageFiles.length+1; page_number++)
        await importScannedPage(document_id, unwrap(fields.friendly_document_id),
                                page_number, pageFiles[page_number-1]);
}

/**
 * Import a scanned page into the content store (converting image to jpg etc).
 * (details of image conversion should be configurable)
 */
async function importScannedPage(document_id: number, friendly_document_id: string, page_number: number, import_path: string): Promise<number> {

    const sourceImagePath = `imports/${friendly_document_id}/${import_path}`;
    if(!await fileExists(sourceImagePath))
        throw new Error(`expected source image ${sourceImagePath} to exist`);
    //console.info('source image path is', sourceImagePath);

    const pageImagesRoot = `content/${friendly_document_id}`;
    const image_ref = 'content/'+
            await content.getDerived(pageImagesRoot, {importPageImage},
                                     ['importPageImage', sourceImagePath], 'jpg');
    const {width, height} = await getImageSize(image_ref);
    const pageId = db().insert<ScannedPage, 'page_id'>(
        'scanned_page', {document_id, page_number, import_path,
                         image_ref, width, height}, 'page_id');

    console.info('imported pageId is', pageId);
    
    return pageId;
}

/**
 * Content store function to do the actual image conversion.
 * (things like quality should be in the parameter list, and thereby in the
 * content store closure)
 */
async function importPageImage(targetImagePath: string, sourceImagePath: string) {
    //const sourceImagePath = contentRoot+'/'+sourceImageRef;
    if(!await fileExists(sourceImagePath))
        throw new Error(`expected source image ${sourceImagePath} to exist`);

    const quality = 80;
    const { code, stdout, stderr } = await new Deno.Command(
        config.imageMagickPath, {
            args: [
                sourceImagePath,
                "-quality", String(quality),
                targetImagePath
            ],
        }).output();

    if(code !== 0)
        throw new Error(`failed to convert image ${sourceImagePath} to ${targetImagePath}: ${new TextDecoder().decode(stderr)}`);

    console.info(`done convert image ${sourceImagePath} to ${targetImagePath}`);
}
