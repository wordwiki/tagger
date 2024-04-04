

import * as model from "./model.ts";
import {FieldVisitorI, Field, ScalarField, BooleanField, IntegerField, FloatField,
        StringField, VariantField, IdField, PrimaryKeyField, RelationField, Schema} from "./model.ts";
import {Assertion, getAssertionPath, getAssertionPathFields} from './schema.ts';
import {unwrap, panic} from "../utils/utils.ts";
import {Markup} from '../utils/markup.ts';
import {VersionedDb, CurrentTupleQuery, CurrentRelationQuery, TupleVersion, generateBeforeOrderKey, generateAfterOrderKey} from './workspace.ts';
import * as workspace from './workspace.ts';
import * as utils from '../utils/utils.ts';
import * as strings from '../utils/strings.ts';
import { rpc } from '../utils/rpc.ts';
import {block} from "../utils/strings.ts";
import {dictSchemaJson} from "./entry-schema.ts";

import { renderToStringViaLinkeDOM } from '../utils/markup.ts';
import { BEGINNING_OF_TIME, END_OF_TIME } from "../utils/timestamp.ts";

// export function buildView(schema: Schema): SchemaView {
//     // return new RelationSQLDriver(db, relationField,
//     //                              relationField.relationFields.map(r=>buildRelationSQLDriver(db, r)));
//     throw new Error();
// }

/**
 *
 */
export abstract class View {

    prompt: string|undefined;
    
    constructor(public field: Field) {
        this.prompt = field.style.$prompt ??
            strings.capitalize(field.name).replaceAll('_', ' ');
    }

    abstract accept<A,R>(v: ViewVisitorI<A,R>, a: A): R;
}

/**
 *
 */
export abstract class ScalarView extends View {
    declare field: ScalarField;
    constructor(field: ScalarField) { super(field); }

    renderView(v: any): Markup {
        return String(v);
    }

    /*abstract*/ renderEditor(relation_id: number, v: any): Markup {
        //throw new Error(`renderEditor not implemented on ${utils.className(this)}`);
        return String(v);
    }

    loadFromEditor(relation_id: number): any {
        return undefined;
    }
}

/**
 *
 */
export class BooleanView extends ScalarView {
    declare field: BooleanField;
    constructor(field: BooleanField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitBooleanView(this, a); }

    renderEditor(relation_id: number, v: any): Markup {
        const checkboxAttrs: Record<string,string> = {type: 'checkbox'};
        if(v) checkboxAttrs['checked'] = '';
        return ['input', checkboxAttrs];
    }
}

/**
 *
 */
export class IntegerView extends ScalarView {
    declare field: IntegerField;
    constructor(field: IntegerField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitIntegerView(this, a); }
}

/**
 *
 */
export class FloatView extends ScalarView {
    declare field: FloatField;
    constructor(field: FloatField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitFloatView(this, a); }
}

/**
 *
 */
export class StringView extends ScalarView {
    declare field: StringField;
    constructor(field: StringField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitStringView(this, a); }

    // TODO: how to know what width to use - easy if one - want full width, but
    //       if multiple?
    // -- give id.
    // -- write a loader that can get the value based on id.
    // -- before writing this, do the other end
    renderEditor(relation_id: number, v: any): Markup {
        return ['input', {type: 'text', placeholder: this.prompt,
                          value: String(v??''),
                          id: `input-${relation_id}-${this.field.name}`}];
    }

    loadFromEditor(relation_id: number): any {
        const inputId = `input-${relation_id}-${this.field.name}`;
        const inputElement = document.getElementById(inputId);
        if(!inputElement)
            throw new Error(`failed to find input element ${inputId}`); // TODO fix error
        const value = (inputElement as HTMLInputElement).value; //getAttribute('value');
        // TODO more checking here.
        return value;
    }
}

/**
 *
 */
export class VariantView extends StringView {
    declare field: VariantField;
    constructor(field: VariantField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitVariantView(this, a); }
}

/**
 *
 */
export class IdView extends ScalarView {
    declare field: IdField;
    constructor(field: IdField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitIdView(this, a); }
}

/**
 *
 */
export class PrimaryKeyView extends ScalarView {
    declare field: PrimaryKeyField;
    constructor(field: PrimaryKeyField) { super(field); }
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitPrimaryKeyView(this, a); }
}

/**
 *
 */
export class RelationView extends View {
    declare field: RelationField;
    #nonRelationViews: View[]|undefined = undefined;
    #scalarViews: ScalarView[]|undefined = undefined;
    #userScalarViews: ScalarView[]|undefined = undefined;
    #relationViews: RelationView[]|undefined = undefined;
    #relationViewsByTag: Record<string, RelationView>|undefined = undefined;
    //#ancestorRelations_: RelationView[]|undefined;
    #descendantAndSelfRelationViews_: RelationView[]|undefined;

    constructor(field: RelationField, public views: View[]) {
        super(field);
        //field.fields.map(new FieldVisitor<never,View>
    }

    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitRelationView(this, a); }

    get nonRelationViews(): View[] {
        return this.#nonRelationViews??=this.views.filter(f=>!(f instanceof RelationView));
    }

    get scalarViews(): ScalarView[] {
        return this.#scalarViews??=
            this.views.filter(f=>f instanceof ScalarView).map(f=>f as ScalarView);
    }

    get userScalarViews(): ScalarView[] {
        return this.#scalarViews??=
            this.scalarViews.filter(f=>!(f instanceof PrimaryKeyView));
    }
    
    get relationViews(): RelationView[] {
        return this.#relationViews??=
            this.views.filter(f=>f instanceof RelationView).map(f=>f as RelationView);
    }

    get relationViewsByTag(): Record<string, RelationView> {
        // Note: we are already validating tag uniqueness across the whole
        //       schema, so no need to check here as well.
        return this.#relationViewsByTag??=
            Object.fromEntries(this.relationViews.map(r=>[r.field.tag, r]));
    }

    get descendantAndSelfRelationViews(): RelationView[] {
        return this.#descendantAndSelfRelationViews_ ??= [this, ...this.descendantRelationViews];
    }

    get descendantRelationViews(): RelationView[] {
        return ([] as RelationView[]).concat(
            ...this.relationViews.map(r=>r.descendantAndSelfRelationViews));
    }
    
    // get relationViewForRelation(): Map<RelationView, RelationView> {
    //     return this.#relationViewForRelation = (()=>{
    //         return new Map();
    //     })();
    // }

    // getRelationViewByName(relationName: string): RelationView {
    //     return this.relationViewForRelation.get(
    //         this.schema.relationsByName[relationName] ?? panic('missing', relationName))
    //         ?? panic();
    // }

    // getRelationViewByTag(relationTag: string): RelationView {
    //     return this.relationViewForRelation.get(
    //         this.schema.relationsByTag[relationTag] ?? panic('missing', relationTag))
    //         ?? panic();
    // }

}

/**
 *
 */
export class SchemaView extends RelationView {
    declare field: Schema;
    #relationViewForRelation: Map<RelationField, RelationView>|undefined = undefined;
    
    constructor(public schema: Schema, views: View[]) {
        super(schema, views);
    }
    
    accept<A,R>(v: ViewVisitorI<A,R>, a: A): R { return v.visitSchemaView(this, a); }

    get relationViewForRelation(): Map<RelationField, RelationView> {
        return this.#relationViewForRelation ??=
            new Map(this.descendantAndSelfRelationViews.map(v=>[v.field, v]));
    }
}

/**
 *
 */
export interface ViewVisitorI<A,R> {
    visitBooleanView(f: BooleanView, a: A): R;
    visitIntegerView(f: IntegerView, a: A): R;
    visitFloatView(f: FloatView, a: A): R;
    visitStringView(f: StringView, a: A): R;
    visitVariantView(f: VariantView, a: A): R;
    visitIdView(f: IdView, a: A): R;
    visitPrimaryKeyView(f: PrimaryKeyView, a: A): R;
    visitRelationView(f: RelationView, a: A): R;
    visitSchemaView(f: SchemaView, a: A): R;
}

/**
 *
 * Need multiple versions of render visitor.
 */
export class RenderVisitor implements ViewVisitorI<any,Markup> {
    
    visitView(f: View, v: any): Markup {
        // TODO this will be an exception later.
        return `[[Unrendered field kind ${utils.className(f)}]]`;
    }
    
    visitBooleanView(f: BooleanView, v: any): Markup {
        return this.visitView(f, v);
    }
    
    visitIntegerView(f: IntegerView, v: any): Markup {
        return this.visitView(f, v);
    }
    
    visitFloatView(f: FloatView, v: any): Markup {
        return this.visitView(f, v);
    }
    
    visitStringView(f: StringView, v: any): Markup {
        return this.visitView(f, v);
    }

    visitVariantView(f: VariantView, v: any): Markup {
        return this.visitView(f, v);
    }
    
    visitIdView(f: IdView, v: any): Markup {
        return this.visitView(f, v);
    }
    
    visitPrimaryKeyView(f: PrimaryKeyView, v: any) {
        return this.visitView(f, v);
    }
    
    visitRelationView(r: RelationView, v: CurrentRelationQuery): Markup {
        //r.modelFields.forEach(f=>f.accept(this, v[f.name]));
    }
    
    visitSchemaView(schema: SchemaView, v: any): Markup {
        return this.visitRelationView(schema, v);
    }
}

// export function renderRelation(r: CurrentRelationQuery): Markup {
//     const id=`relation-${r.schema.name}-${r.src.parent?.id ?? 0}`;
//     return (
//         ['table', {class: 'relation relation-${r.src.schema.name}', id},
//          [...r.tuples.values()].map(t=>
//              ['tr', {},
//               ['th', {}, t.schema.name],
//               //tv.schema.[lookup view for schema].map()
//              ])
//         ]);
// }

// For example, called on a dictionary entry (or root)
// What is a nice rendering?
/**
 * Tuple is rendered as a table with two options:
 * - show history - multi-rows with one per history item.
 * - edit mode - editor for current item (with prev value
 *   shown in history if history is open)
 * - later, may add more control of what items are displayed
 *   in history.
 * - no labels on fields for now (dictionary entries are simple enough).
 */
// - history should have a different font/weight etc - but need to
//   be in same table for layout.
// - editing of current uses same table (also for layout)
// - nested tuples are separate tables.
// - COMPLICATION: multiple tuples in a relation should be on one table (will
//   look ragged otherwise).
// - this will force the prompts into the table.
// - so use a colspan to embed the child items table in the parent table.
// - so the scope of render needs to be larger that a single tuple.
// - the scope of the entity that is rendered is a relation (recursively)


// XXX Also need to refactor this to allow rendering starting at any subtree.
//     (for post change rerender).


/**
 *
 */
export class ActiveViews {
    workspace: VersionedDb;
    activeViews: Map<string, ActiveView> = new Map();
    currentlyOpenTupleEditor: TupleEditor|undefined = undefined;

    constructor(workspace: VersionedDb) {
        this.workspace = workspace;
    }
    
    registerActiveView(activeView: ActiveView) {
        this.activeViews.set(activeView.id, activeView);
    }

    rerenderAllViews() {
        for(const activeView of this.activeViews.values())
            activeView.rerender();
    }

    rerenderViewById(viewId: string) {
        this.activeViews.get(viewId)?.rerender();
    }
    
    getCurrentlyOpenTupleEditorForTupleId(renderRootId: string, tuple_id: number): TupleEditor|undefined {
        return (this.currentlyOpenTupleEditor !== undefined &&
            this.currentlyOpenTupleEditor.renderRootId === renderRootId &&
            this.currentlyOpenTupleEditor.ref_tuple_id === tuple_id)
            ? this.currentlyOpenTupleEditor
            : undefined;
    }

    getCurrentlyOpenTupleEditorForRenderRootId(renderRootId: string): TupleEditor|undefined {
        return (this.currentlyOpenTupleEditor !== undefined &&
            this.currentlyOpenTupleEditor.renderRootId === renderRootId)
            ? this.currentlyOpenTupleEditor
            : undefined;
    }

    editNewAbove(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number) {
        this.editNewPeer(renderRootId, db_tag, tuple_tag, tuple_id, 'before');
    }
    
    editNewBelow(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number) {
        this.editNewPeer(renderRootId, db_tag, tuple_tag, tuple_id, 'after');
    }

    editNewFirstChild(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number, child_tag: string) {
        this.editNewChild(renderRootId, db_tag, tuple_tag, tuple_id, 'firstChild', child_tag);
    }

    editNewLastChild(renderRootId: string, db_tag: string, tuple_tag: string, tuple_id: number, child_tag: string) {
        this.editNewChild(renderRootId, db_tag, tuple_tag, tuple_id, 'lastChild', child_tag);
    }

    editNewPeer(renderRootId: string,
                refDbTag: string, refTupleTag: string, refTupleId: number,
                refKind: 'before'|'after') {

        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        const refAssertion = refTuple.mostRecentTuple?.assertion
            ?? panic('cannot use ref tuple', refTupleId);
        const newTupleSchema = refTuple.schema;
        
        const mostRecentTupleVersion = refTuple.mostRecentTuple;
        const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

        //const activeView = this.activeViews.get(renderRootId)
        const parent = this.workspace.getVersionedTupleParentRelation(
            getAssertionPath(refTuple.mostRecentTuple.assertion));
        const order_key = refKind === 'before'
            ? generateBeforeOrderKey(parent, refTupleId)
            : generateAfterOrderKey(parent, refTupleId);
        
        // TODO make this new assertion making less raw.
        const newAssertion: Assertion = Object.assign(
            {},
            getAssertionPathFields(refAssertion),
            {
                ty: refAssertion.ty,
                assertion_id: id,
                valid_from: BEGINNING_OF_TIME,
                valid_to: END_OF_TIME,
                [`id${newTupleSchema.ancestorRelations.length}`]: id,
                id: id,
                order_key,
            });

        console.info('REF assertion', refAssertion);
        console.info('NEW assertion', newAssertion);
        
        this.openFieldEdit(renderRootId, refKind, refDbTag, refTupleTag, refTupleId, newAssertion);
    }

    editNewChild(renderRootId: string,
                 refDbTag: string, refTupleTag: string, refTupleId: number,
                 refKind: TupleRefKind, child_tag: string) {
        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        //const newTupleSchema = 
    }

    editNew(renderRootId: string,
            refDbTag: string, refTupleTag: string, refTupleId: number,
            refKind: TupleRefKind, schema: RelationField) {
        
        
    }
        
    editTupleUpdate(renderRootId: string, refDbTag: string, refTupleTag: string, refTupleId: number) {
        // --- Find the reference tuple
        const refTuple = this.workspace.getVersionedTupleById(
            refDbTag, refTupleTag, refTupleId)
            ?? panic('cannot find ref tuple for edit', refTupleId);

        // NEXT populate assertion better!
        // CReating the assertion is a job for the global workspace.
        // USING TUPLE FOR THIS - this needs to factor
        const mostRecentTupleVersion = refTuple.mostRecentTuple;
        const new_assertion: Assertion = Object.assign(
            {},
            mostRecentTupleVersion.assertion,
            // TODO: change_by fields clear, from/to
            {assertion_id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)});

        this.openFieldEdit(renderRootId, 'replaceSelf', refDbTag, refTupleTag, refTupleId,
                           new_assertion);
    }
    
    /**
     *
     */
    openFieldEdit(renderRootId: string,
                  refKind: TupleRefKind,
                  refDbTag: string,
                  refTupleTag: string,
                  refTupleId: number,
                  new_assertion: Assertion) {
        console.info('begin field edit', refKind, refTupleTag, refTupleId);

        // --- Only one tuple editor can be open at a time
        //     (later will get fancier and close open ones or something TODO)
        if(this.currentlyOpenTupleEditor) {
            alert('A field editor is already open');
            return;
        }
        
        // --- Find the view
        const tupleSchema =
            this.workspace.tables.get(refDbTag)?.schema
            ?.descendantAndSelfRelationsByTag[new_assertion.ty]
            ?? panic('unable to find schema for tag', new_assertion.ty);
        const viewTree: SchemaView =
            (this.activeViews.get(renderRootId)
                ?? panic('unable to find render root', renderRootId))
                .viewTree;
        const tupleView = viewTree.relationViewForRelation.get(tupleSchema) ??
            panic('unable to find relation view for relation', tupleSchema.tag);
        
        // --- Instantiate a field editor
        this.currentlyOpenTupleEditor = new TupleEditor(
            renderRootId, tupleView, refKind, refTupleId, new_assertion);

        // Re-render the tuple with the now open tuple editor
        // - we can use the global workspace to find the tuple by tuple_id ???
        // - figure out how this works for the first tuple in a relation (but sounds
        //   patchable)
        this.rerenderViewById(renderRootId);
    }

    relationViewForRelation(renderRootId: string,
                            tupleSchema: RelationField): RelationView {
        const viewTree: SchemaView =
            (this.activeViews.get(renderRootId)
                ?? panic('unable to find render root', renderRootId))
                .viewTree;
        return viewTree.relationViewForRelation.get(tupleSchema) ??
            panic('unable to find relation view for relation', tupleSchema.tag);
    }
    
    endFieldEdit() {
        if(!this.currentlyOpenTupleEditor) {
            alert('No field editor is currently open');
            return;
        }

        const tupleEditor = this.currentlyOpenTupleEditor;

        tupleEditor.endFieldEdit();
        
        const renderRootId = tupleEditor.renderRootId;
        const newAssertion = tupleEditor.assertion;

        // TODO Should check if differnt than prev tuple TODO TODO
        // - what from and to times to use for new assertions.
        //newAssertion =
        this.workspace.applyProposedAssertion(newAssertion);

        this.currentlyOpenTupleEditor = undefined;
        
        this.rerenderViewById(renderRootId);
    }
}

/**
 *
 */
export class ActiveView {
    constructor(public id: string,
                public viewTree: SchemaView, // This is restricting view to be from one schema XXX revisit
                public query: ()=>CurrentTupleQuery) {
    }

    rerender() {
        const queryResults = this.query();
        const renderer = new Renderer(this.viewTree, this.id);
        const markup = renderer.renderTuple(queryResults);

        const container = document.getElementById(this.id)
            ?? panic('unable to find view anchor', this.id);

        console.info(`rendering ${this.id}`);
        container.innerHTML = renderToStringViaLinkeDOM(markup);
    }
}


type TupleRefKind = 'replaceSelf' | 'firstChild' | 'lastChild' | 'before' | 'after';


/**
 *
 *
 */
export class TupleEditor {
    constructor(public renderRootId: string,
                public view: RelationView,
                public ref_kind: TupleRefKind,
                public ref_tuple_id: number,
                public assertion: Assertion) {
    }
    
    endFieldEdit() {
        // We need the schema here to do the reload.
        // Copy field values from form into assertion.
        // field values are named.

        // const view = this.viewTree.relationViewForRelation.get(schema)
        //     ?? panic('unable find relation view for relation', schema.name);
        // return [
        //     ['tr', {id: `tuple-${this.renderRootId}-${t.assertion.assertion_id}`},
        //      ['th', {}, view.prompt],
        //      view.userScalarViews.map(v=>this.renderScalarCellEditor(r, v, t))
        //     ],
        //     ['tr', {},
        //      ['th', {}, ''],
        //      ['td', {colspan: view.userScalarViews.length+3},
        //       ['button', {type:'button', class:'btn btn-primary',
        //                   onclick:'activeViews.endFieldEdit()'}, 'Save'],
        //      ]]
        // ];

        console.info('in endFieldEdit');
        for(const fieldView of this.view.userScalarViews) {
            const formValue = fieldView.loadFromEditor(this.assertion.assertion_id);
            console.info('formValue is', formValue);
            if(formValue !== undefined) {
                (this.assertion as any)[fieldView.field.bind] = formValue;
            }
        }
    }
}

/**
 *
 */
// TODO somewhere we want a workspace.  - probably assoc with active views
// makes more sense for views to own workspace than the other way around.
// difficulty
let activeViews_: ActiveViews|undefined = undefined;
export function activeViews(): ActiveViews {
    return activeViews_ ??= new ActiveViews(new VersionedDb([]));
}

/**
 *
 */
export class Renderer {
    
    constructor(public viewTree: SchemaView, public renderRootId: string) {
    }

    renderRelation0(r: CurrentRelationQuery): Markup {
        const schema = r.schema;
        // TODO somehow change this to find tuple editor targeting an insert into
        //      this relation
        // const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForTupleId(this.renderRootId, r.src.id);
        // const currentlyOpenTupleEditorPosition = currentlyOpenTupleEditor?.assertion.order
        // _key;
        const view = this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
        return (
            // This table has the number of cols in the schema for 'r'
            ['table', {class: `relation relation-${schema.name}`},
             [...r.tuples.values()].map(t=>this.renderTuple(t))
            ]);
    }

    // - For a before or after tuple editor, need to notice and render in here.
    // - how about for an empty list?
    //    - need to chenge the // render child relations loop to also render
    //      if there is an open tuple editor targetting the relation
    // - that is all
    // - the order of the temporary relation should probably be based on order id
    // - hoist the same tuple editing to here as well.
    renderRelation(r: CurrentRelationQuery): Markup {
        const schema = r.schema;
        // TODO somehow change this to find tuple editor targeting an insert into
        //      this relation
        // const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForTupleId(this.renderRootId, r.src.id);
        // const currentlyOpenTupleEditorPosition = currentlyOpenTupleEditor?.assertion.order
        // _key;

        const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForRenderRootId(this.renderRootId);
        const refKind = currentlyOpenTupleEditor?.ref_kind;
        const refId = currentlyOpenTupleEditor?.ref_tuple_id;
        
        const view = this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
        return (
            // This table has the number of cols in the schema for 'r'
            ['table', {class: `relation relation-${schema.name}`},
             [(refId === r.src.parent.id && refKind === 'firstChild')
                 ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!) : undefined],
             [...r.tuples.values()].map(t=>{
                 const tuple_id = t.src.id;
                 if(tuple_id === refId && refKind === 'replaceSelf')
                     return this.renderTupleEditor(t.schema, currentlyOpenTupleEditor!);
                 return [
                     [tuple_id === refId && refKind === 'before'
                         ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
                         : undefined],
                     this.renderTuple(t),
                     [tuple_id === refId && refKind === 'after'
                         ? this.renderTupleEditor(t.schema,  currentlyOpenTupleEditor!)
                         : undefined]
                 ];
             }),
             [(refId === r.src.parent.id && refKind === 'lastChild')
                 ? this.renderTupleEditor(r.src.schema, currentlyOpenTupleEditor!) : undefined],
            ]);
    }

    renderTuple(r: CurrentTupleQuery): Markup {
        const schema = r.schema;
        const view = this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
        const isHistoryOpen = false;
        const currentlyOpenTupleEditor = activeViews().getCurrentlyOpenTupleEditorForTupleId(this.renderRootId, r.src.id);

        return [
            // --- If this tuple a proposed new tuple under edit, render the editor,
            //     otherwise render the current row.
            // currentlyOpenTupleEditor
            //     ? this.renderTupleEditor(r, currentlyOpenTupleEditor)
            //     : this.renderCurrentTupleRow(r),
            this.renderCurrentTupleRow(r),

            // --- If history is open for this tuple, render history rows
            isHistoryOpen ? [
                r.historicalTupleVersions.map(h=>
                    ['tr', {},
                     ['td', {}],  // Empty header col
                     view.userScalarViews.map(v=>this.renderScalarCell(r, v, h, true)),
                     //['td', {class: 'tuple-menu'}, this.renderSampleMenu()]
                    ])
                ]: undefined,

            // --- Render child relations
            schema.relationFields.length > 0 ? [
                ['tr', {},
                 ['td', {class: 'relation-container', colspan: view.userScalarViews.length+3},
                  Object.values(r.childRelations).map(
                      childRelation=>this.renderRelation(childRelation))
                 ]]
            ]: undefined
        ];
    }

    renderCurrentTupleRow(r: CurrentTupleQuery): Markup {
        const schema = r.schema;
        const view = this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
        const current = r.mostRecentTupleVersion;
        const tupleJson = JSON.stringify(current?.assertion);
        return (
            ['tr', {id: `tuple-${this.renderRootId}-${current?.assertion_id}`,
                    class: 'tuple'},
             ['th', {}, view.prompt],
             current ? [  // current is undefined for deleted tuples - more work here TODO
                 view.userScalarViews.map(v=>this.renderScalarCell(r, v, current))
             ]: undefined,
             ['td', {class: 'tuple-history', title: tupleJson}, '↶'], // style different if have history etc.
             ['td', {class: 'tuple-menu'}, this.renderCurrentTupleMenu(r)]
            ]);
    }    

    // ??? What happens if the tuple is rendered twice on the same screen - this current id scheme implies both should be under
    // edit.   We either have to disallow having the renderer twice (which seems like an unreasonable restriction) - or scope this
    // somehow.
    // We need to scope our render trees!
    // - Probably better to move tuple under edit into this view class? (it really does belong to it - not to the
    //   shared global thing)
    renderScalarCell(r: CurrentTupleQuery, v: ScalarView, t: TupleVersion, history: boolean=false): Markup {
        const value = (t.assertion as any)[v.field.bind]; // XXX fix typing
        return (
            ['td', {class: `field field-${v.field.schemaTypename()}`,
                    onclick:`activeViews.editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`,
                   },
             v.renderView(value)
            ]);
    }

    renderTupleEditor(schema: RelationField, t: TupleEditor): Markup {
        //const schema = r.schema;
        const view = this.viewTree.relationViewForRelation.get(schema)
            ?? panic('unable find relation view for relation', schema.name);
        return [
            ['tr', {id: `tuple-${this.renderRootId}-${t.assertion.assertion_id}`},
             ['th', {}, view.prompt],
             view.userScalarViews.map(v=>this.renderScalarCellEditor(v, t))
            ],
            ['tr', {},
             ['th', {}, ''],
             ['td', {colspan: view.userScalarViews.length+3},
              ['button', {type:'button', class:'btn btn-primary',
                          onclick:'activeViews.endFieldEdit()'}, 'Save'],
            ]]
        ];
    }

    renderScalarCellEditor(v: ScalarView, t: TupleEditor): Markup {
        const value = (t.assertion as any)[v.field.bind];     // XXX be fancy here; 
        return (
            ['td', {class: `fieldedit`},
             v.renderEditor(t.assertion.assertion_id, value)
            ]);
    }

    // TODO: the event handlers should not be literal onclick scripts on each
    //       item (bloat).
    // TODO: add an 'Insert Child XXX' for each child relation kind.
    renderCurrentTupleMenu(r: CurrentTupleQuery): Markup {
        const insertChildMenuItems = 
            r.schema.relationFields.map(c=>
                ['li', {},
                 ['a', {class:'dropdown-item', href:'#',
                        onclick:`activeViews.editNewLastChild('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id}, '${c.tag}')`},
                  `Insert Child ${this.viewTree.relationViewForRelation.get(c)?.prompt}`
                 ]]);
        
        return (
            ['div', {class:'dropdown'},
             ['button',
              {class:'btn btn-secondary dropdown-toggle',
               type:'button', 'data-bs-toggle':'dropdown', 'aria-expanded':'false'},
              '≡'],
             ['ul', {class:'dropdown-menu'},
              ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews.editTupleUpdate('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Edit']],
              ['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Move Up']],
              ['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Move Down']],
              ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews.editNewAbove('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Above']],
              ['li', {}, ['a', {class:'dropdown-item', href:'#', onclick:`activeViews.editNewBelow('${this.renderRootId}', '${r.schema.schema.tag}', '${r.schema.tag}', ${r.src.id})`}, 'Insert Below']],
              insertChildMenuItems,
              ['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Delete']],
              ['li', {}, ['a', {class:'dropdown-item', href:'#'}, 'Show History']],
             ]]);
    }
}

/**
 *
 */
export class FieldToView implements FieldVisitorI<any,View> {
    visitBooleanField(f: BooleanField, v: any): View { return new BooleanView(f); }
    visitIntegerField(f: IntegerField, v: any): View { return new IntegerView(f); }
    visitFloatField(f: FloatField, v: any): View { return new FloatView(f); }
    visitStringField(f: StringField, v: any): View { return new StringView(f); }
    visitVariantField(f: VariantField, v: any): View { return new VariantView(f); }
    visitIdField(f: IdField, v: any): View { return new IdView(f); }
    visitPrimaryKeyField(f: PrimaryKeyField, v: any): View { return new PrimaryKeyView(f); }
    visitRelationField(f: RelationField, v: any): View {
        return new RelationView(f, f.fields.map(fieldToView));
    }
    visitSchema(f: Schema, v: any): View {
        return new SchemaView(f, f.fields.map(fieldToView));
    }
}

const fieldToViewInst = new FieldToView();

export function fieldToView(f: Field): View {
    return f.accept(fieldToViewInst, undefined);
}

export function schemaView(f: Schema): SchemaView {
    return new SchemaView(f, f.fields.map(fieldToView));
}

/**
 *
 */
export function renderEditor(r: RelationView): any {
}

// export async function run0() {
//     console.info('rendering sample');

//     const root = document.getElementById('root') ?? panic();
//     root.innerHTML = 'POW!';

//     const entryId = 1000;
//     const assertions = await rpc`getAssertionsForEntry(${entryId})`;
//     console.info('Assertions', JSON.stringify(assertions, undefined, 2));

//     const rendered = workspace.testRenderEntry(assertions);

//     root.innerHTML = renderToStringViaLinkeDOM(rendered);
    
    
// }

// export async function run() {
//     console.info('rendering sample 2');
//     const views = activeViews();

//     const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
//     views.workspace.addTable(dictSchema);

    



    
//     const dictView = schemaView(dictSchema);
    
//     views.registerActiveView(
//         new ActiveView('root',
//                        dictView,
//                        ()=>new CurrentTupleQuery(views.workspace.getTableByTag('di'))));
    
//     const root = document.getElementById('root') ?? panic();
//     root.innerHTML = 'POW!';

//     const entryId = 1000;
//     const assertions = await rpc`getAssertionsForEntry(${entryId})`;
//     console.info('Assertions', JSON.stringify(assertions, undefined, 2));

//     const rendered = workspace.testRenderEntry(assertions);

//     root.innerHTML = renderToStringViaLinkeDOM(rendered);
    
    
// }

export async function run() {
    console.info('rendering sample 2');
    const views = activeViews();

    const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);
    views.workspace.addTable(dictSchema);
    
    const dictView = schemaView(dictSchema);
    
    views.registerActiveView(
        new ActiveView('root',
                       dictView,
                       ()=>new CurrentTupleQuery(views.workspace.getTableByTag('di'))));
    
    // const root = document.getElementById('root') ?? panic();
    // root.innerHTML = 'POW!';

    // TODO make this less weird
    const entryId = 1000;
    const assertions = await rpc`getAssertionsForEntry(${entryId})`;
    console.info('Assertions', JSON.stringify(assertions, undefined, 2));
    assertions.forEach((a:Assertion)=>views.workspace.applyAssertion(a));

    
    activeViews().rerenderAllViews();
    
}

export const exportToBrowser = ()=> ({
    activeViews,
    run,
    //beginFieldEdit,
});

export const routes = ()=> ({
});
