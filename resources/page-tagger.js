// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

function pageEditorMouseDown(event) {

    // --- Adjust event target to be ancestor or self element of application interest.
    const target = adjustEventTarget(event.target);

    // --- If we have an active drag operation - abort it
    dragTxAbort();

    if(event.shiftKey) {
        // --- Holding down shift allows drawing new boxes even
        //     if the click action would normally be interpreted
        //     by another widget in that space.
        newBoxMouseDown(event, target);
    } else {
        // --- Dispatch the click based on widget kind
        switch(getWidgetKind(target)) {
        case 'box': boxMouseDown(event, target); break
        case 'grabber': grabberMouseDown(event, target); break;
        default: newBoxMouseDown(event, target); break;
        }
    }
}

function pageEditorMouseMove(event) {
    const target = adjustEventTarget(event.target);
    dragTxOnMouseMove(event, target);
}

function pageEditorMouseUp(event) {
    const target = adjustEventTarget(event.target);
    dragTxCommit(event, target);
}

function boxMouseDown(event, target) {
    selectBox(target);
}

/**
 * Handles the dragging operation of a box grabber.
 *
 * Registers a dragTx, and subsequent mouse operations are routed to
 * the dragTx until the operation is completed or aborted.
 *
 * The extraAbortAction parameter is used when creating new boxes
 * to remove the box if it has not yet reached a viable size.
 */
function grabberMouseDown(event, grabber, extraAbortAction=undefined) {

    // --- Store the drag start mouse X and Y
    const dragStartClientX = event.clientX;
    const dragStartClientY = event.clientY;
    
    // --- Select the grabber (and containing box and group).
    selectBoxGrabber(grabber);

    // --- Find the box that contains this grabber.
    const box = getSelectedBox();

    // --- Store the initial coordinates of the box in case we need to abort.
    const initialX = getIntAttribute(box, 'x');
    const initialY = getIntAttribute(box, 'y');
    const initialWidth = getIntAttribute(box, 'width');
    const initialHeight = getIntAttribute(box, 'height');

    // --- Figure out which of the four grabbers this is
    const isTop = grabber.getAttribute('cy') === '0';
    const isLeft = grabber.getAttribute('cx') === '0';

    const minWidth = 20;
    const minHeight = 20;

    // --- Add 'drag-in-progress' class to #annotatedPage to disable some
    //     hover behaviour that would be annoying during a drag.
    document.getElementById('annotatedPage')?.classList.add('drag-in-progress');
    
    // --- Register the drag tx - handles mouseMove events until the mouseDown (or abort)
    dragTxBegin({
        onMouseMove(event, target) {
            const deltaX = event.clientX-dragStartClientX;
            const deltaY = event.clientY-dragStartClientY;
            switch(true) {
            case isTop && isLeft: {  // top left grabber
                const clampedDeltaX = Math.min(deltaX, initialWidth-minWidth);
                const clampedDeltaY = Math.min(deltaY, initialHeight-minHeight);
                box.setAttribute('x', initialX + clampedDeltaX);
                box.setAttribute('y', initialY + clampedDeltaY);
                box.setAttribute('width', initialWidth - clampedDeltaX);
                box.setAttribute('height', initialHeight - clampedDeltaY);
                break;
            }
            case isTop && !isLeft: { // top right grabber
                const clampedDeltaY = Math.min(deltaY, initialHeight-minHeight);
                box.setAttribute('y', initialY + clampedDeltaY);
                box.setAttribute('width', Math.max(initialWidth + deltaX, minWidth));
                box.setAttribute('height', initialHeight - clampedDeltaY);
                break;
            }
            case !isTop && isLeft: { // bottom left grabber
                const clampedDeltaX = Math.min(deltaX, initialWidth-minWidth);
                const clampedDeltaY = Math.min(deltaY, initialHeight-minHeight);
                box.setAttribute('x', initialX + clampedDeltaX);
                box.setAttribute('width', Math.max(initialWidth - deltaX, minWidth));
                box.setAttribute('height', Math.max(initialHeight + deltaY, minHeight));
                break;
            }
            case !isTop && !isLeft: {// bottom right grabber
                box.setAttribute('width', Math.max(initialWidth + deltaX, minWidth));
                box.setAttribute('height', Math.max(initialHeight + deltaY, minHeight));
                break;
            }
            }
        },
        onCommit(event, target) {
            // --- If we are about to commit an invalid change, abort instead
            //     (in practice, this only occurs for new box draws, where they
            //     go though a larval stage where they are too small to be a
            //     valid box - for existing boxes, we don't allow the UI to shrink
            //     below viable)
            if(getIntAttribute(box, 'width') < minWidth ||
               getIntAttribute(box, 'height') < minHeight) {
                this.onAbort();
                return;
            }

            document.getElementById('annotatedPage')?.classList.remove('drag-in-progress');

            const bounding_box_id = safeParseInt(stripRequiredPrefix(box.id, 'bb_'));
            const x = getIntAttribute(box, 'x');
            const y = getIntAttribute(box, 'y');
            const w = getIntAttribute(box, 'width');
            const h = getIntAttribute(box, 'height');
            const updateUrl = `/updateBoundingBoxShape(${bounding_box_id}, {x:${x},y:${y},w:${w},h:${h}})`;
            console.info('requestiong', updateUrl);
            const response = fetch(updateUrl);
            //const responseJson = await response.json();
            //console.log('UPDATE RETURNED', responseJson);
            console.info('commit - post to server here!');
        },
        onAbort() {
            document.getElementById('annotatedPage')?.classList.remove('drag-in-progress');
            box.setAttribute('x', initialX);
            box.setAttribute('y', initialY);
            box.setAttribute('width', initialWidth);
            box.setAttribute('height', initialHeight);

            // Used for new boxes that have not yet reached viable dimensions.
            if(extraAbortAction)
                extraAbortAction();
        }
    });
}

function puppyMouseDown(event, target) {
    const scannedPageSvg = document.getElementById('scanned-page') ??
          panic('unable to find scanned page element');
    const scannedPageSvgLocation = scannedPageSvg.getBoundingClientRect();


    console.info('--- PUPPY!');
    console.info('event', event);
    console.info({clientX: event.clientX, clientY: event.clientY,
                  screenX: event.screenX, screenY: event.screenY});
    console.info('scannedPageSvgLocation', scannedPageSvgLocation);
    
    const x = event.clientX - scannedPageSvgLocation.x ; // Wrong
    const y = event.clientY - scannedPageSvgLocation.y; // Wrong
    console.info({x, y});
    console.info();

    const grabber = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    grabber.classList.add('puppy');
    grabber.setAttribute('cx', x)
    grabber.setAttribute('cy', y)
    grabber.setAttribute('r', 20);

    // Want to figure out coords
    console.info('adding grabber', grabber);
    scannedPageSvg.appendChild(grabber);    
}

function newBoxMouseDown(event, target) {
    
    const scannedPageSvg = document.getElementById('scanned-page') ??
          panic('unable to find scanned page element');
    const scannedPageSvgLocation = scannedPageSvg.getBoundingClientRect();
    
    // --- Compute initial size and position for box
    const x = event.clientX - scannedPageSvgLocation.x;
    const y = event.clientY - scannedPageSvgLocation.y;
    const width = 0;
    const height = 0;
    const grabberRadius = 12;

    // --- Create the parent bounding group (long term we
    //     will usually be adding to an existing group instead - but
    //     do this for now).
    const boundingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    boundingGroup.classList.add('group');
    boundingGroup.classList.add('WORD');

    // --- Create the boundingBox
    const boundingBox = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    boundingBox.classList.add('box');
    boundingBox.setAttribute('x', x)
    boundingBox.setAttribute('y', y)
    boundingBox.setAttribute('width', width)
    boundingBox.setAttribute('height', height)
    boundingGroup.appendChild(boundingBox);
    
    // --- Add the frame rect
    const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.classList.add('frame');
    frame.setAttribute('x', 0)
    frame.setAttribute('y', 0)
    frame.setAttribute('width', '100%')
    frame.setAttribute('height', '100%')
    boundingBox.appendChild(frame);
    
    // --- Add the four corner grabber circles
    const grabbers = [];
    for(const cx of ['0', '100%']) {
        for(const cy of ['0', '100%']) {
            const grabber = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            grabber.classList.add('grabber');
            grabber.setAttribute('cx', cx)
            grabber.setAttribute('cy', cy)
            grabber.setAttribute('r', grabberRadius)
            grabbers.push(grabber);
        }
    }
    grabbers.forEach(g=>boundingBox.appendChild(g));
    const lowerLeftGrabber = grabbers[3];

    // --- Add the new group to the document
    scannedPageSvg.appendChild(boundingGroup);

    // --- Start a resize operation on lower left grabber on the box,
    //     removing to box if it never reaches a viable size.
    console.info('grabber is', lowerLeftGrabber);
    grabberMouseDown(event, lowerLeftGrabber, ()=>boundingGroup.remove());
}

/**
 * Sometimes the element of interest to the application will be occluded
 * by a child decoration element.  Normally this is handled by registering
 * the event handler on the element of interest, and allowing the event
 * to bubble up to it.
 *
 * But we have chosen to forgo bubbling and handle all events at the svg page
 * level, so we need to deal with this occlusion problem some other way.
 *
 * This function is called at the beginning of every event handler to
 * adjust the event target to the nearest containing element of application
 * interest.
 */
function adjustEventTarget(target) {
    switch(true) {
    case target?.tagName === 'rect' && target?.classList?.contains('frame'):
        return target.parentElement;
    default:
        return target;
    }
}

// ---------------------------------------------------------------------------
// --- Selection Model -------------------------------------------------------
// ---------------------------------------------------------------------------

/*
 * The page editor selection model mirrors the data containment model.
 *
 * At any one time there can be an active boundingBoxGroup and active
 * boundingBox and an active grabber.
 *
 * Selecting a child element always also select the containing elements.
 * (for example, selecting a grabber will also select the containing
 * boundingBox and boundingBoxGroup)
 *
 * When a group is selected, we also move the <svg> element for that group
 * to the bottom of the list of groups.
 *
 * When a box is selected, we also move the <svg> element for that box to
 * the bottom of the list of boxes within the containing group.
 *
 * These two moves mean that the group and the box are last painted - thus
 * having the highest z-index - thus being non occluded by any other element
 * so that they can be interacted with.
 */
  
/**
 * Clear the group, box and grabber selections.
 */
function clearSelection() {
    // Note: there should never be more than one group/box/grabber active at a time,
    // we are doing querySelectorAll instead of querySelector because
    // paranoia is good policy for code running in the browser.
    Array.from(document.querySelectorAll('svg.group.active')).
        map(e=>e.classList.remove('active'));
    Array.from(document.querySelectorAll('svg.box.active')).
        map(e=>e.classList.remove('active'));
    Array.from(document.querySelectorAll('circle.grabber.active')).
        map(e=>e.classList.remove('active'));
}

/**
 * Select a group.
 */
function selectGroup(group) {
    if(!isGroup(group))
        throw new Error('select group called on non-group');
    clearSelection();
    group.classList.add('active');
    moveElementToEndOfParent(group);
}

/**
 * Select a box and the containing group.
 */
function selectBox(box) {
    if(!isBox(box))
        throw new Error('select box called on non-box');
    selectGroup(box.parentElement);
    box.classList.add('active');
    moveElementToEndOfParent(box);
}

/**
 * Select a grabber and the containing box and group.
 */
function selectBoxGrabber(grabber) {
    if(!isGrabber(grabber))
        throw new Error('select grabber called on non-grabber');
    selectBox(grabber.parentElement);
    grabber.classList.add('active');
}

/*
 * Prefer using these getter/is functions over doing
 * direct querySelectors in the rest of this editor - this
 * will reduce the blast radius if we need to make
 * structural changes to the markup.
 */

function getSelectedGroup() {
    return document.querySelector('svg.group.active');
}

function getSelectedBox() {
    return document.querySelector('svg.box.active');
}

function getSelectedGrabber() {
    return document.querySelector('circle.grabber.active');
}

function isGroup(elem) {
    return elem.classList.contains('group');
}

function isBox(elem) {
    return elem.classList.contains('box');
}

function isGrabber(elem) {
    return elem.classList.contains('grabber');
}

function getWidgetKind(elem) {
    const classList = elem.classList;
    switch(true) {
      case classList.contains('group'): return 'group';
      case classList.contains('box'): return 'box';
      case classList.contains('grabber'): return 'grabber';
      default: return undefined;
    }
}

// ------------------------------------------------------------------------
// --- Bookkeeping for an active drag operation ---------------------------
// ------------------------------------------------------------------------

let activeDragTx = undefined;

function dragTxValidate(dragTx) {
    if(!(dragTx.onMouseMove instanceof Function) ||
       !(dragTx.onCommit instanceof Function) ||
       !(dragTx.onAbort instanceof Function))
        throw new Error('malformed dragTx');
}

function dragTxBegin(dragTx) {
    dragTxAbort();
    dragTxValidate(dragTx);
    activeDragTx = dragTx;
}

function dragTxOnMouseMove(event, target) {
    activeDragTx?.onMouseMove(event, target);
}

function dragTxCommit(event, target) {
    activeDragTx?.onCommit(event, target);
    activeDragTx = undefined;
}

function dragTxAbort() {
    activeDragTx?.onAbort();
    activeDragTx = undefined;
}

// -----------------------------------------------------------------------
// --- Misc --------------------------------------------------------------
// -----------------------------------------------------------------------

function safeParseInt(v) {
    const r = Number.parseInt(v);
    if(Number.isNaN(r))
        throw new Error(`expected integer, got ${v}`);
    return r;
}

function getIntAttribute(elem, name) {
    const attrText = elem.getAttribute(name);
    if(!attrText) // missing attr is represented as "" or null as per the spec
        throw new Error(`missing required integer attribute ${name} on elem ${elem}`);
    const attrVal = Number.parseInt(attrText);
    if(Number.isNaN(attrVal))
        throw new Error(`expected integer valued attribute ${name} on elem ${elem} - got ${String(attrVal)}`);
    return attrVal;
}

/**
 * Moves an element to be the last child of the containing element.
 *
 * Does nothing if already last element (so cheap to repeatedly call).
 * 
 * This is used for z-order reasons in our svg based editor (ie. we
 * want the selected item to have the highest z-order so that it is
 * fully interactive)
 */
function moveElementToEndOfParent(elem) {
    // --- If we are already last element in parent - nothing to do.
    if(!elem.nextSibling)
        return;

    // --- If we have no parent - nothing to do.
    const parent = elem.parentElement;
    if(!parent)
        return;

    // --- Relocate element to end of parent element
    //     (note that appendChild is defined to remove the node if it already
    //     exists in the document - so this is a move operation)
    parent.appendChild(elem);
}

/**
 * This is used in conjunction with the ?? operator to deal with unexpected
 * nulls.
 *
 * For example:
 * 
 * document.getElementById('scanned-page') ?? panic('unable to find scanned page');
 */
function panic(message) {
    throw new Error('panic: '+message);
}

function stripRequiredPrefix (s, prefix) {
    if (s.startsWith (prefix))
        return s.substring (prefix.length);
    else
        throw new Error(`expected string "${s}" to have prefix "${prefix}"`);
}
