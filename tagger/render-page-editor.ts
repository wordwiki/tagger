import * as pageEditor from './page-editor.ts';
import { db, Db, PreparedQuery, assertDmlContainsAllFields, boolnum, defaultDbPath } from "./db.ts";
import { selectLayer, selectLayerByLayerName } from "./schema.ts";
import {ScannedDocument, ScannedDocumentOpt, selectScannedDocument, selectScannedDocumentByFriendlyId, ScannedPage, ScannedPageOpt, selectScannedPage, selectScannedPageByPageNumber, selectBoundingGroup, BoundingBox, boundingBoxFieldNames, Shape, BoundingGroup, boundingGroupFieldNames, selectBoundingBoxesForGroup, maxPageNumberForDocument, updateBoundingBox, getOrCreateNamedLayer, selectBoundingBox} from './schema.ts';
import {block} from "../utils/strings.ts";
import * as utils from "../utils/utils.ts";
import {range} from "../utils/utils.ts";
import { writeAll } from "https://deno.land/std@0.195.0/streams/write_all.ts";
import { renderToStringViaLinkeDOM } from '../utils/markup.ts';
import * as config from './config.ts';
import * as derivedPageImages from './derived-page-images.ts';

type GroupJoinPartial = Pick<BoundingGroup, 'column_number'|'heading_level'|'heading'|'color'>;
type BoxGroupJoin = BoundingBox & GroupJoinPartial;

export const boxesForPageLayer = ()=>db().
    prepare<BoxGroupJoin, {page_id:number, layer_id:number}>(
        block`
/**/      SELECT ${boundingBoxFieldNames.map(n=>'bb.'+n).join()},
/**/             bg.column_number, bg.heading_level, bg.heading, bg.color
/**/         FROM bounding_box AS bb LEFT JOIN bounding_group AS bg USING(bounding_group_id)
/**/         WHERE bb.page_id = :page_id AND
/**/               bb.layer_id = :layer_id
/**/         ORDER BY bb.x, bb.y, bb.bounding_box_id`);

export function renderPageEditor(page_id: number,
                                 layer_id: number,
                                 reference_layer_ids: number[],
                                 total_pages_in_document?: number,
                                 scale_factor:number=4): any {

    const page = selectScannedPage().required({page_id});

    total_pages_in_document ??= maxPageNumberForDocument().required({document_id: page.document_id}).max_page_number;

    const pageImageUrl = '/'+page.image_ref;

    // --- Render user boxes
    const boxes = boxesForPageLayer().all({page_id, layer_id});
    const boxesByGroup = utils.groupToMap(boxes, box=>box.bounding_group_id);
    const blocksSvg = 
        [...boxesByGroup.entries()].
        map(([groupId, boxes])=>renderGroup(page, groupId, boxes));

    // --- We don't render reference boxes that have been imported to user
    //     boxes that are still active on the page.
    const importedFromBoundingBoxIds =
        new Set(boxes.map(b=>b.imported_from_bounding_box_id).filter(b=>b!==null));
    
    // --- Render reference layers
    let refBlocksSvg:any = reference_layer_ids.flatMap(layer_id=> {
        const refBoxes = boxesForPageLayer().all({page_id, layer_id})
            .filter(b=>!importedFromBoundingBoxIds.has(b.bounding_box_id));
        const refBoxesByGroup = utils.groupToMap(refBoxes, box=>box.bounding_group_id);
        return [...refBoxesByGroup.entries()].
            map(([groupId, boxes])=>renderGroup(page, groupId, boxes, true));
    });


    return (
        ['html', {},
         ['head', {},
          ['meta', {charset:"utf-8"}],
          ['meta', {name:"viewport", content:"width=device-width, initial-scale=1"}],
          config.bootstrapCssLink,
          ['link', {href: '/resources/page-editor.css', rel:'stylesheet', type:'text/css'}],
          //['script', {src:'/resources/page-editor.js'}]],
          ['script', {src:'/scripts/tagger/page-editor.js'}],
          
          ['script', {}, block`
 /**/           let imports = {};
 /**/           let activeViews = undefined`],
          //['script', {src:'/scripts/tagger/instance.js', type: 'module'}],
          
 //          ['script', {type: 'module'}, block`
 // /**/           import * as workspace from '/scripts/tagger/workspace.js';
 // /**/           import * as view from '/scripts/tagger/view.js';
 // /**/
 // /**/           imports = Object.assign(
 // /**/                        {},
 // /**/                        view.exportToBrowser(),
 // /**/                        workspace.exportToBrowser());
 // /**/
 // /**/           activeViews = imports.activeViews();
 // /**/
 // /**/           document.addEventListener("DOMContentLoaded", (event) => {
 // /**/             console.log("DOM fully loaded and parsed");
 // /**/             view.run();
 // /**/             //workspace.renderSample(document.getElementById('root'))
 // /**/           });`
 //          ]
         ], // head
         
         ['body', {},

          ['div', {},
           ['h1', {}, 'PDM Textract preview page', page.page_number],
           renderPageJumper(page.page_number, total_pages_in_document)],
          
          ['div', {id: 'annotatedPage'},
           //['img', {src:pageImageUrl, width:page.width, height:page.height}],
           ['svg', {id: 'scanned-page', width:page.width/scale_factor, height:page.height/scale_factor,
                    viewBox: `0 0 ${page.width} ${page.height}`,
                    onmousedown: 'pageEditorMouseDown(event)',
                    onmousemove: 'pageEditorMouseMove(event)',
                    onmouseup: 'pageEditorMouseUp(event)',
                    'data-layer-id': layer_id,
                    'data-page-id': page_id,
                    'data-scale-factor': scale_factor,
                   },
            ['image', {href:pageImageUrl, x:0, y:0, width:page.width, height:page.height}],
            refBlocksSvg,
            blocksSvg]],

          
          Array.from(boxesByGroup.keys()).map(bounding_group_id =>
              ['p', {},
               renderStandaloneGroup(bounding_group_id)]
              ),
          
          config.bootstrapScriptTag,
          
         ] // body,

        ] // html
    );
}

export function renderGroup(page: ScannedPage,
                            groupId: number, boxes: BoxGroupJoin[], refLayer: boolean=false): any {
    utils.assert(boxes.length > 0, 'Cannot render an empty group');
    const group: GroupJoinPartial = boxes[0];

    // --- Group frame contains all boxes + a margin.
    const groupMargin = 10;
    const groupX = Math.max(Math.min(...boxes.map(b=>b.x)) - groupMargin, 0);
    const groupY = Math.max(Math.min(...boxes.map(b=>b.y)) - groupMargin, 0);
    const groupLeft = Math.min(Math.max(...boxes.map(b=>b.x+b.w)) + groupMargin, page.width);
    const groupBottom = Math.min(Math.max(...boxes.map(b=>b.y+b.h)) + groupMargin, page.height);
    const stroke = (refLayer ? 'grey' : group.color) ?? 'yellow';
    return (
        ['svg', {class:`group ${refLayer?'ref':''}`, id:`bg_${groupId}`, stroke},
         ['rect', {class:"group-frame", x:groupX, y:groupY,
                   width:groupLeft-groupX,
                   height:groupBottom-groupY}],
         boxes.map(b=>renderBox(b, refLayer))
        ]);
}

export function renderBoxOld(box: BoxGroupJoin): any {
    return ['rect', {class:"segment", x:box.x, y:box.y, width:box.w, height:box.h}];
}

export function renderBox(box: BoxGroupJoin, refLayer: boolean=false): any {
    return ['svg', {class:`box ${refLayer?'ref':''}`, x:box.x, y:box.y, width:box.w, height:box.h, id: `bb_${box.bounding_box_id}`},
            ['rect', {class:"frame", x:0, y:0, width:'100%', height:'100%'}],
            //['rect', {class:"frame2", x:0, y:0, width:'100%', height:'100%'}],
            ['circle', {class:"grabber", cx:0, cy:0, r:12}],
            ['circle', {class:"grabber", cx:0, cy:'100%', r:12}],
            ['circle', {class:"grabber", cx:'100%', cy:0, r:12}],
            ['circle', {class:"grabber", cx:'100%', cy:'100%', r:12}]];
}

export function renderPageJumper(current_page_num: number, total_pages: number): any {
    const targetPageNumbers = Array.from(new Set(
        [1,
         ...range(1, Math.floor(total_pages/100)+1).map(v=>v*100),
         ...range(0, 10).map(v=>Math.floor(current_page_num/100)*100+v*10),
         ...range(0, 10).map(v=>Math.floor(current_page_num/10)*10+v),
         current_page_num-1, current_page_num-2,
         current_page_num+1, current_page_num+2,
         total_pages]))
        .filter(p=>p>=1 && p<=total_pages)
        .toSorted((a, b) => a - b);
    
    return targetPageNumbers.map(n=>
        [['a', {href:`./${n}.html`,
                class: n===current_page_num?'current-page-jump':'page-jump'}, n],
         ' ']);
}

export async function friendlyRenderPageEditor(friendly_document_id: string,
                                               page_number: number,
                                               layer_name: string = 'TextractWord'): Promise<any> {
    const pdm = selectScannedDocumentByFriendlyId().required({friendly_document_id});
    //const
    const pdmTaggingLayer = getOrCreateNamedLayer(pdm.document_id, 'Tagging', 0);
    const pdmWordLayer = selectLayerByLayerName().required({document_id: pdm.document_id, layer_name});
    const pdmSamplePage = selectScannedPageByPageNumber().required(
        {document_id: pdm.document_id, page_number});
    const totalPagesInDocument = maxPageNumberForDocument().required({document_id: pdm.document_id}).max_page_number;
    console.info('max_page_number', totalPagesInDocument);
    return renderPageEditor(pdmSamplePage.page_id, pdmTaggingLayer, [pdmWordLayer.layer_id], totalPagesInDocument);
}

if (import.meta.main) {
    const friendly_document_id = Deno.args[0] ?? 'PDM';
    const page_number = parseInt(Deno.args[1] ?? '1');
    const markup = await friendlyRenderPageEditor(friendly_document_id, page_number);
    console.info(renderToStringViaLinkeDOM(markup));
}

// --------------------------------------------------------------------------------
// --- RPCs -----------------------------------------------------------------------
// --------------------------------------------------------------------------------

export const routes = ()=> ({
    pageEditor: renderPageEditor,
    updateBoundingBoxShape,
    newBoundingBoxInNewGroup,
    newBoundingBoxInExistingGroup,
    copyRefBoxToNewGroup,
    copyRefBoxToExistingGroup,
    migrateBoxToGroup,
});

export function updateBoundingBoxShape(bounding_box_id: number, shape: Shape) {
    db().transaction(()=>
        updateBoundingBox(bounding_box_id, ['x', 'y', 'w', 'h'], shape));
}

export function newBoundingBoxInNewGroup(page_id: number, layer_id: number,
                                         shape: {x:number, y:number, w:number, h:number},
                                         color: string): {bounding_group_id: number, bounding_box_id: number} {
    return db().transaction(()=>{

        const page = selectScannedPage().required({page_id});
        const layer = selectLayer().required({layer_id});
        utils.assert(page.document_id === layer.document_id);
        const document_id = page.document_id;
        
        const bounding_group_id = db().insert<BoundingGroup, 'bounding_group_id'>(
            'bounding_group', {
                document_id, // NEED to pass in
                layer_id,
                color,
            }, 'bounding_group_id');

        const bounding_box_id = db().insert<BoundingBox, 'bounding_box_id'>(
            'bounding_box', {bounding_group_id, document_id, layer_id, page_id,
                             x: shape.x, y: shape.y, w: shape.w, h: shape.h}, 'bounding_box_id');

        return {bounding_group_id, bounding_box_id};
    });
}

export function newBoundingBoxInExistingGroup(page_id: number,
                                              bounding_group_id: number,
                                              shape: Shape): {bounding_box_id: number} {
    return db().transaction(()=>{

        if(typeof bounding_group_id !== 'number')
            throw new Error('invalid bounding_group_id parameter in call to newBoundingBoxInExistingGroup');

        const group = selectBoundingGroup().required({bounding_group_id});

        const bounding_box_id = db().insert<BoundingBox, 'bounding_box_id'>(
            'bounding_box', {
                bounding_group_id,
                document_id: group.document_id,
                layer_id: group.layer_id, page_id,
                x: shape.x, y: shape.y, w: shape.w, h: shape.h}, 'bounding_box_id');

        return {bounding_box_id};
    });
}

export function copyRefBoxToNewGroup(ref_box_id: number, layer_id: number, color: string): {bounding_group_id: number, bounding_box_id: number} {
    return db().transaction(()=>{

        if(typeof ref_box_id !== 'number')
            throw new Error('invalid ref_box_id parameter in call to copyRefToNewGroup');
        
        const refBox = selectBoundingBox().required({bounding_box_id: ref_box_id});

        const bounding_group_id = db().insert<BoundingGroup, 'bounding_group_id'>(
            'bounding_group', {
                document_id: refBox.document_id,
                layer_id,
                color,
            }, 'bounding_group_id');
        
        const bounding_box_id = db().insert<BoundingBox, 'bounding_box_id'>(
            'bounding_box', {
                imported_from_bounding_box_id: refBox.bounding_box_id,
                bounding_group_id,
                document_id: refBox.document_id,
                layer_id, page_id: refBox.page_id,
                x: refBox.x, y: refBox.y, w: refBox.w, h: refBox.h}, 'bounding_box_id');

        return {bounding_group_id, bounding_box_id};
    });
}

export function copyRefBoxToExistingGroup(bounding_group_id: number, ref_box_id: number): {bounding_box_id: number} {
    return db().transaction(()=>{

        if(typeof ref_box_id !== 'number')
            throw new Error('invalid ref_box_id parameter in call to copyRefToNewGroup');

        const group = selectBoundingGroup().required({bounding_group_id});
        console.info('target group layer id is', group.layer_id);
        const refBox = selectBoundingBox().required({bounding_box_id: ref_box_id});

        const bounding_box_id = db().insert<BoundingBox, 'bounding_box_id'>(
            'bounding_box', {
                imported_from_bounding_box_id: refBox.bounding_box_id,
                bounding_group_id,
                document_id: refBox.document_id,
                layer_id: group.layer_id, page_id: refBox.page_id,
                x: refBox.x, y: refBox.y, w: refBox.w, h: refBox.h}, 'bounding_box_id');

        return {bounding_box_id};
    });
}

export function migrateBoxToGroup(bounding_group_id: number, bounding_box_id: number): {} {
    return db().transaction(()=>{

        // TODO add more paranoia here.
        
        updateBoundingBox(bounding_box_id, ['bounding_group_id'], {bounding_group_id});

        return {};
    });
}

// --------------------------------------------------------------------------------
// --- Standalone group render ----------------------------------------------------
// --------------------------------------------------------------------------------

/**
 *
 */
export function renderStandaloneGroup(bounding_group_id: number,
                                      scale_factor:number=4,
                                      box_stroke:string = 'green'): any {

    console.info('RENDERING STANDALONE GROUP', bounding_group_id);
    
    // --- Find boxes for group
    const boxes = selectBoundingBoxesForGroup().all({bounding_group_id});

    // --- If no boxes in group, render as empty.
    if(boxes.length === 0) {
        console.info('STANDALONE GROUP IS EMPTY');
        return ['div', {}, 'Empty Group'];
    }
    
    // --- We don't currently support groups that span pages
    const page_id = boxes[0].page_id;
    boxes.forEach(b=>b.page_id === page_id
        || utils.panic('all boxes in a group must be on a single page'));

    // --- Load page
    const page = selectScannedPage().required({page_id});

    // --- Group frame contains all boxes + a margin
    //     (note that margin is reduced if there is not enough space)
    const groupMargin = 75;
    const groupX = Math.max(Math.min(...boxes.map(b=>b.x)) - groupMargin, 0);
    const groupY = Math.max(Math.min(...boxes.map(b=>b.y)) - groupMargin, 0);
    const groupRight = Math.min(Math.max(...boxes.map(b=>b.x+b.w)) + groupMargin, page.width);
    const groupBottom = Math.min(Math.max(...boxes.map(b=>b.y+b.h)) + groupMargin, page.height);
    const groupWidth = groupRight-groupX;
    const groupHeight = groupBottom-groupY;
    console.info({groupX, groupY, groupRight, groupBottom, groupWidth, groupHeight});

    const groupSvg =
        ['svg', {class:`group`, id:`bg_${bounding_group_id}`, stroke: box_stroke},
         ['rect', {class:"group-frame", x:groupX, y:groupY,
                   width:groupRight-groupX,
                   height:groupBottom-groupY}],
         
         boxes.map(box=>
             ['svg', {class:`box`, x:box.x-groupX, y:box.y-groupY, width:box.w, height:box.h, id: `bb_${box.bounding_box_id}`},
              ['rect', {class:"frame", x:0, y:0, width:'100%', height:'100%'}]
             ])
        ];

    // This is wrong !! - need to rework this using tiles !!
    const pageImageUrl = '/'+page.image_ref;
    const image = ['image',
                   {href:pageImageUrl, x:-groupX, y:-groupY, width:page.width, height:page.height}];
    
    return ['svg', {width:groupWidth/scale_factor, height:groupHeight/scale_factor,
                    viewBox: `0 0 ${groupWidth} ${groupHeight}`,
                    onmousedown: 'pageEditorMouseDown(event)',
                    'data-page-id': page_id,
                    'data-scale-factor': scale_factor,
                   },
            image,
            groupSvg,
           ]; // svg
}

export function renderTiledImage(srcImagePath: string,
                                 tileWidth=config.defaultTileWidth,
                                 tileHeight=config.defaultTileHeight) {
}
